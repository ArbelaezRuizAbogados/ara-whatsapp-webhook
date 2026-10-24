// Devuelve el texto real (encabezado, cuerpo, pie y botones) de las plantillas
// aprobadas, leido directo de Meta, para que el visor muestre lo mismo que ve
// el cliente en vez del marcador "[plantilla: nombre]".
const WABA_ID = '4533782176902793';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'] || req.query.secret;
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates?fields=name,status,components&limit=100`,
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: data });
    }

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
    console.error('Error en /api/templates:', err);
    return res.status(500).json({ error: String(err) });
  }
}
