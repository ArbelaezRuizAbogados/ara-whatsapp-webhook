// Separa los eventos de la cola entre los que van al agente y los que no
// (contactos bloqueados o bajo control humano). Cachea la consulta por contacto
// para no repetir lecturas a Redis por cada evento.
async function splitQueue(kv, raw) {
  const keep = [];
  const drop = [];
  const cache = {};
  for (const item of raw) {
    const parsed = typeof item === 'string' ? JSON.parse(item) : item;
    const contact = parsed.from || parsed.recipient_id;
    let filtered = false;
    if (contact) {
      if (!(contact in cache)) {
        const [takenOver, blocked] = await Promise.all([
          kv.get(`whatsapp:takeover:${contact}`),
          kv.get(`whatsapp:blocked:${contact}`),
        ]);
        cache[contact] = !!(takenOver || blocked);
      }
      filtered = cache[contact];
    }
    if (filtered) {
      drop.push(typeof item === 'string' ? item : JSON.stringify(item));
    } else {
      keep.push(parsed);
    }
  }
  return { keep, drop };
}

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
    const { index, action } = req.body || {};

    // Limpieza manual: saca de la cola todos los eventos de contactos
    // bloqueados o bajo control humano (el historial del visor no se toca).
    // No usa el candado, asi que se puede correr aunque el agente este activo.
    if (action === 'purge_filtered') {
      const raw = await kv.lrange('whatsapp:inbox', 0, -1);
      const { keep, drop } = await splitQueue(kv, raw);
      let removed = 0;
      if (drop.length) {
        const p = kv.pipeline();
        for (const s of drop) p.lrem('whatsapp:inbox', 1, s);
        const results = await p.exec();
        removed = results.reduce((sum, r) => sum + (Number(r) || 0), 0);
      }
      return res.status(200).json({
        success: true,
        scanned: raw.length,
        to_remove: drop.length,
        removed,
        remaining_expected: keep.length,
      });
    }

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
