export default async function handler(req, res) {
  const secret = req.headers['x-poll-secret'] || req.query.secret;
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { kv } = await import('@vercel/kv');

  if (req.method === 'GET') {
    // Lectura de solo consulta, NO toca el candado de /api/inbox - segura
    // para usar desde el visor sin interferir con el agente.
    const raw = await kv.lrange('whatsapp:inbox', 0, -1);
    const items = raw.map((item, index) => ({
      index,
      ...(typeof item === 'string' ? JSON.parse(item) : item),
    }));
    return res.status(200).json({ items });
  }

  if (req.method === 'POST') {
    const { index } = req.body || {};
    if (!Number.isInteger(index)) {
      return res.status(400).json({ error: 'Falta "index" (numero entero) - el mismo que devuelve GET /api/queue.' });
    }
    const raw = await kv.lrange('whatsapp:inbox', 0, -1);
    if (index < 0 || index >= raw.length) {
      return res.status(404).json({ error: 'No existe ese indice en la cola.' });
    }
    const target = raw[index];
    const targetStr = typeof target === 'string' ? target : JSON.stringify(target);
    await kv.lrem('whatsapp:inbox', 1, targetStr);
    return res.status(200).json({ success: true, removed_index: index });
  }

  res.status(405).send('Method Not Allowed');
}
