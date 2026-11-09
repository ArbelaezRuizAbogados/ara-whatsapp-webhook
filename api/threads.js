const WABA_ID = '4533782176902793';

// Texto real (encabezado, cuerpo, pie y botones) de las plantillas aprobadas,
// leido directo de Meta, para que el visor muestre lo mismo que ve el cliente.
// Vive aqui (?templates=1) porque el plan gratis de Vercel permite maximo 12
// funciones por despliegue y ya estan todas usadas.
async function getTemplates(res) {
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates?fields=name,status,category,components&limit=100`,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data });

    const out = {};
    for (const t of data.data || []) {
      const comps = t.components || [];
      const byType = (type) => comps.find((c) => c.type === type);
      const header = byType('HEADER');
      const body = byType('BODY');
      const footer = byType('FOOTER');
      const buttons = byType('BUTTONS');

      const parts = [];
      if (header && header.format === 'TEXT' && header.text) parts.push(header.text);
      if (body && body.text) parts.push(body.text);
      if (footer && footer.text) parts.push(footer.text);

      out[t.name] = {
        text: parts.join('\n\n'),
        buttons: ((buttons && buttons.buttons) || []).map((b) => b.text),
        status: t.status,
        category: t.category,
      };
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(out);
  } catch (err) {
    console.error('Error leyendo plantillas:', err);
    return res.status(500).json({ error: String(err) });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'] || req.query.secret;
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  // POST: guardar / editar / borrar el nombre, la nota y el rotulo de un contacto.
  // Los campos que no vienen en el cuerpo se conservan (asi se puede cambiar
  // solo el rotulo sin tocar el nombre). Va aqui y no en un archivo nuevo por
  // el limite de 12 funciones de Vercel.
  if (req.method === 'POST') {
    // Crear una plantilla nueva y enviarla a revision de Meta (mismo limite de
    // 12 funciones: se reutiliza este endpoint).
    // Subir un archivo de ejemplo (PDF/imagen) a Meta y devolver el handle que
    // exigen las plantillas con encabezado de documento o imagen.
    if (req.body && req.body.uploadSample) {
      try {
        const tok = process.env.WHATSAPP_ACCESS_TOKEN;
        const { url, type, name } = req.body.uploadSample;
        const file = await fetch(url);
        const buf = Buffer.from(await file.arrayBuffer());
        const dbg = await (await fetch(
          `https://graph.facebook.com/v21.0/debug_token?input_token=${tok}&access_token=${tok}`
        )).json();
        const appId = dbg && dbg.data && dbg.data.app_id;
        if (!appId) return res.status(502).json({ error: 'No se pudo obtener el app_id', detail: dbg });
        const sess = await (await fetch(
          `https://graph.facebook.com/v21.0/${appId}/uploads?file_length=${buf.length}&file_type=${encodeURIComponent(type || 'application/pdf')}&file_name=${encodeURIComponent(name || 'archivo')}`,
          { method: 'POST', headers: { Authorization: `Bearer ${tok}` } }
        )).json();
        if (!sess.id) return res.status(502).json({ error: 'No se pudo abrir la sesion de carga', detail: sess });
        const up = await (await fetch(`https://graph.facebook.com/v21.0/${sess.id}`, {
          method: 'POST',
          headers: { Authorization: `OAuth ${tok}`, file_offset: '0' },
          body: buf,
        })).json();
        return res.status(up.h ? 200 : 502).json(up);
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    }
    if (req.body && req.body.newTemplate) {
      try {
        const t = req.body.newTemplate;
        const r = await fetch(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(t),
        });
        const data = await r.json();
        return res.status(r.ok ? 200 : r.status).json(data);
      } catch (err) {
        return res.status(500).json({ error: String(err) });
      }
    }
    const { to, name, note, label } = req.body || {};
    if (!to) {
      return res.status(400).json({ error: 'Falta "to" (numero del contacto).' });
    }
    const { kv } = await import('@vercel/kv');
    const prevRaw = await kv.hget('whatsapp:contactinfo', String(to));
    const prev = (typeof prevRaw === 'string' ? JSON.parse(prevRaw) : prevRaw) || {};
    const cleanName = name === undefined ? (prev.name || '') : String(name || '').trim().slice(0, 80);
    const cleanNote = note === undefined ? (prev.note || '') : String(note || '').trim().slice(0, 300);
    const cleanLabel = label === undefined ? (prev.label || '') : String(label || '').trim().slice(0, 40);
    if (!cleanName && !cleanNote && !cleanLabel) {
      await kv.hdel('whatsapp:contactinfo', String(to));
    } else {
      await kv.hset('whatsapp:contactinfo', { [String(to)]: { name: cleanName, note: cleanNote, label: cleanLabel } });
    }
    return res.status(200).json({ success: true, to: String(to), name: cleanName, note: cleanNote, label: cleanLabel });
  }

  // Busqueda de texto dentro de todas las conversaciones (?search=palabra).
  if (req.query.search) {
    const q = String(req.query.search).toLowerCase().trim();
    const { kv } = await import('@vercel/kv');
    const nums = await kv.zrange('whatsapp:contacts', 0, -1, { rev: true });
    const hits = [];
    for (const number of nums) {
      const raw = await kv.lrange(`whatsapp:thread:${number}`, 0, -1);
      let found = null;
      for (const m of raw) {
        const o = typeof m === 'string' ? JSON.parse(m) : m;
        const text = String((o && (o.text || o.button)) || '');
        const at = text.toLowerCase().indexOf(q);
        if (at >= 0) {
          const from = Math.max(0, at - 25);
          found = (from > 0 ? '...' : '') + text.slice(from, at + q.length + 45);
          break;
        }
      }
      if (found) hits.push({ number, snippet: found });
    }
    return res.status(200).json({ hits });
  }

  if (req.query.templates) {
    return getTemplates(res);
  }

  const { kv } = await import('@vercel/kv');
  const contacts = await kv.zrange('whatsapp:contacts', 0, -1, { rev: true });

  // Contactos guardados (nombre y nota por numero): un solo registro, una sola
  // lectura por consulta.
  const saved = (await kv.hgetall('whatsapp:contactinfo')) || {};
  const infoOf = (n) => {
    const v = saved[n];
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return { name: (o && o.name) || '', note: (o && o.note) || '', label: (o && o.label) || '' };
  };

  const single = req.query.number;
  if (single) {
    const raw = await kv.lrange(`whatsapp:thread:${single}`, 0, -1);
    const messages = raw.map((m) => (typeof m === 'string' ? JSON.parse(m) : m));
    const takeover = !!(await kv.get(`whatsapp:takeover:${single}`));
    const blocked = !!(await kv.get(`whatsapp:blocked:${single}`));
    return res.status(200).json({ number: single, takeover, blocked, ...infoOf(single), messages });
  }

  // Pocas lecturas: ultimo mensaje desde un solo registro (whatsapp:last) y
  // takeover/bloqueo con un mget cada uno. Los contactos que aun no estan en
  // el registro se leen una vez y quedan guardados.
  const lastMap = (await kv.hgetall('whatsapp:last')) || {};
  const tKeys = contacts.map((n) => `whatsapp:takeover:${n}`);
  const bKeys = contacts.map((n) => `whatsapp:blocked:${n}`);
  const tVals = tKeys.length ? await kv.mget(...tKeys) : [];
  const bVals = bKeys.length ? await kv.mget(...bKeys) : [];
  const list = [];
  for (let i = 0; i < contacts.length; i++) {
    const number = contacts[i];
    let last = lastMap[number];
    if (typeof last === 'string') last = JSON.parse(last);
    if (!last) {
      const raw = await kv.lrange(`whatsapp:thread:${number}`, -1, -1);
      last = raw[0] ? (typeof raw[0] === 'string' ? JSON.parse(raw[0]) : raw[0]) : null;
      if (last) await kv.hset('whatsapp:last', { [String(number)]: last });
    }
    list.push({ number, last: last || null, takeover: !!tVals[i], blocked: !!bVals[i], ...infoOf(number) });
  }

  res.status(200).json({ contacts: list });
}
