const WABA_ID = '4533782176902793';

// Texto real (encabezado, cuerpo, pie y botones) de las plantillas aprobadas,
// leido directo de Meta, para que el visor muestre lo mismo que ve el cliente.
// Vive aqui (?templates=1) porque el plan gratis de Vercel permite maximo 12
// funciones por despliegue y ya estan todas usadas.
async function getTemplates(res) {
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates?fields=name,status,components&limit=100`,
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

  // POST: guardar / editar / borrar el nombre y la nota de un contacto.
  // (Va aqui y no en un archivo nuevo por el limite de 12 funciones de Vercel.)
  if (req.method === 'POST') {
    const { to, name, note } = req.body || {};
    if (!to) {
      return res.status(400).json({ error: 'Falta "to" (numero del contacto).' });
    }
    const { kv } = await import('@vercel/kv');
    const cleanName = String(name || '').trim().slice(0, 80);
    const cleanNote = String(note || '').trim().slice(0, 300);
    if (!cleanName && !cleanNote) {
      await kv.hdel('whatsapp:contactinfo', String(to));
    } else {
      await kv.hset('whatsapp:contactinfo', { [String(to)]: { name: cleanName, note: cleanNote } });
    }
    return res.status(200).json({ success: true, to: String(to), name: cleanName, note: cleanNote });
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
    return { name: (o && o.name) || '', note: (o && o.note) || '' };
  };

  const single = req.query.number;
  if (single) {
    const raw = await kv.lrange(`whatsapp:thread:${single}`, 0, -1);
    const messages = raw.map((m) => (typeof m === 'string' ? JSON.parse(m) : m));
    const takeover = !!(await kv.get(`whatsapp:takeover:${single}`));
    const blocked = !!(await kv.get(`whatsapp:blocked:${single}`));
    return res.status(200).json({ number: single, takeover, blocked, ...infoOf(single), messages });
  }

  const list = [];
  for (const number of contacts) {
    const raw = await kv.lrange(`whatsapp:thread:${number}`, -1, -1);
    const last = raw[0] ? (typeof raw[0] === 'string' ? JSON.parse(raw[0]) : raw[0]) : null;
    const takeover = !!(await kv.get(`whatsapp:takeover:${number}`));
    const blocked = !!(await kv.get(`whatsapp:blocked:${number}`));
    list.push({ number, last, takeover, blocked, ...infoOf(number) });
  }

  res.status(200).json({ contacts: list });
}
