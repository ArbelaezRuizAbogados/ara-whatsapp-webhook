export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { to, message, template, language, components, sender } = req.body || {};
  if (!to || (!message && !template)) {
    return res.status(400).json({ error: 'Falta "to" y uno de "message" o "template".' });
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const who = sender === 'human' ? 'human' : 'agent';

  const payload = template
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: language || 'es_CO' },
          components: components || [],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      };

  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await metaRes.json();

    if (!metaRes.ok) {
      console.error('Error de Meta al enviar:', JSON.stringify(data));
      return res.status(metaRes.status).json({ error: data });
    }

    try {
      const { kv } = await import('@vercel/kv');
      await kv.rpush(`whatsapp:thread:${to}`, JSON.stringify({
        direction: 'out',
        sender: who,
        text: message || `[plantilla: ${template}]`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        received_at: new Date().toISOString(),
      }));
      await kv.zadd('whatsapp:contacts', { score: Math.floor(Date.now() / 1000), member: to });

      if (who === 'human') {
        await kv.set(`whatsapp:takeover:${to}`, '1');
      }
    } catch (logErr) {
      console.error('Error guardando en historial:', logErr);
    }

    return res.status(200).json({ success: true, result: data });
  } catch (err) {
    console.error('Error enviando mensaje:', err);
    return res.status(500).json({ error: String(err) });
  }
}
