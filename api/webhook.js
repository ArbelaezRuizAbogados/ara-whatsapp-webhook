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
    // Meta espera un 200 rapido; respondemos antes de terminar de guardar.
    res.status(200).send('EVENT_RECEIVED');

    try {
      const { kv } = await import('@vercel/kv');
      const entry = req.body?.entry?.[0];
      const value = entry?.changes?.[0]?.value;
      const messages = value?.messages || [];
      const statuses = value?.statuses || [];

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
      }

      for (const st of statuses) {
        await kv.rpush('whatsapp:inbox', JSON.stringify({
          kind: 'status',
          message_id: st.id,
          recipient_id: st.recipient_id,
          status: st.status,
          timestamp: st.timestamp,
          received_at: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.error('Error guardando evento de WhatsApp:', err);
    }
    return;
  }

  res.status(405).send('Method Not Allowed');
}
