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
    messages.push(typeof item === 'string' ? JSON.parse(item) : item);
  }

  res.status(200).json({ messages });
}
