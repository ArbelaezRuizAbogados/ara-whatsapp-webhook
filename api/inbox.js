export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { kv } = await import('@vercel/kv');
  const messages = [];
  // Drena la cola completa: cada mensaje se entrega una sola vez.
  while (true) {
    const item = await kv.lpop('whatsapp:inbox');
    if (!item) break;
    const parsed = typeof item === 'string' ? JSON.parse(item) : item;

    // Si el contacto esta bajo control humano, no se le entrega al agente -
    // ya quedo guardado en el historial (whatsapp:thread) para el visor.
    const contact = parsed.from || parsed.recipient_id;
    if (contact) {
      const takenOver = await kv.get(`whatsapp:takeover:${contact}`);
      if (takenOver) continue;
    }

    messages.push(parsed);
  }

  res.status(200).json({ messages });
}
