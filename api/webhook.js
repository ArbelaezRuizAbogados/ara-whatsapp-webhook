export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method === 'POST') {
    // Log temporal de diagnostico: guarda el cuerpo crudo de CADA evento que
    // llega, sin importar el tipo, para poder ver exactamente que envia Meta.
    console.log('Webhook body:', JSON.stringify(req.body));

    try {
      const { kv } = await import('@vercel/kv');
      const entry = req.body?.entry?.[0];
      const value = entry?.changes?.[0]?.value;
      const field = entry?.changes?.[0]?.field;
      const messages = value?.messages || [];
      const statuses = value?.statuses || [];

      console.log('Campo:', field, '| mensajes:', messages.length, '| estados:', statuses.length);

      for (const msg of messages) {
        await kv.rpush('whatsapp:inbox', JSON.stringify({
          kind: 'message',
          id: msg.id,
          from: msg.from,
          timestamp: msg.timestamp,
          type: msg.type,
          text: msg.text?.body || null,
          button: msg.button || null,
          interactive: msg.interactive || null,
          raw: msg,
          received_at: new Date().toISOString(),
        }));

        // Historial permanente para el visor (no se borra al consumir /api/inbox).
        await kv.rpush(`whatsapp:thread:${msg.from}`, JSON.stringify({
          direction: 'in',
          sender: 'customer',
          text: msg.text?.body || `[${msg.type}]`,
          button: msg.button?.text || msg.interactive?.button_reply?.title || null,
          timestamp: msg.timestamp,
          received_at: new Date().toISOString(),
        }));
        await kv.zadd('whatsapp:contacts', { score: Number(msg.timestamp), member: msg.from });
      }

      for (const st of statuses) {
        await kv.rpush('whatsapp:inbox', JSON.stringify({
          kind: 'status',
          message_id: st.id,
          recipient_id: st.recipient_id,
          status: st.status,
          timestamp: st.timestamp,
          errors: st.errors || null,
          received_at: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.error('Error guardando evento de WhatsApp:', err);
    }

    res.status(200).send('EVENT_RECEIVED');
    return;
  }

  res.status(405).send('Method Not Allowed');
}
