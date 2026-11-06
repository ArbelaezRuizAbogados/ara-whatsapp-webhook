export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { to, message, template, language, components, sender, image, document, caption, filename } = req.body || {};
  // image / document: URL publica (https) del archivo. caption: texto opcional que
  // acompana la imagen o el PDF. filename: nombre que ve el cliente en el PDF.
  const mediaUrl = image || document;
  if (mediaUrl && !/^https:\/\//i.test(mediaUrl)) {
    return res.status(400).json({ error: 'La URL de "image"/"document" debe ser publica y empezar por https://' });
  }
  if (!to || (!message && !template && !mediaUrl)) {
    return res.status(400).json({ error: 'Falta "to" y uno de "message", "template", "image" o "document".' });
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const who = sender === 'human' ? 'human' : 'agent';

  const payload = image
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: image, ...(caption ? { caption } : {}) },
      }
    : document
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: {
          link: document,
          filename: filename || decodeURIComponent(document.split('/').pop().split('?')[0]),
          ...(caption ? { caption } : {}),
        },
      }
    : template
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
        // preview_url: sin esto la Cloud API NO genera vista previa del enlace.
        text: { body: message, preview_url: /https?:\/\//i.test(message) },
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
      const entry = {
        direction: 'out',
        sender: who,
        text: message
          || (image ? `[imagen]${caption ? ' ' + caption : ''}` : null)
          || (document ? `[documento: ${payload.document.filename}]${caption ? ' ' + caption : ''}` : null)
          || `[plantilla: ${template}]`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        received_at: new Date().toISOString(),
      };
      await kv.rpush(`whatsapp:thread:${to}`, JSON.stringify(entry));
      // Ultimo mensaje por contacto en un solo registro: el visor lista los
      // contactos con 1 lectura en vez de 1 por contacto (ahorra comandos).
      await kv.hset('whatsapp:last', { [String(to)]: entry });
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
