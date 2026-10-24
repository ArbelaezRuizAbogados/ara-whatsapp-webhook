// Chequeo gratuito (sin IA) para decidir si vale la pena despertar al agente.
// Devuelve cuantos eventos de la cola requieren accion real. De paso limpia lo
// que el agente nunca atiende: eventos de contactos bloqueados / bajo control
// humano y confirmaciones de entrega normales (sent / delivered / read sin error).
// Los fallos de entrega SI cuentan como accion (el agente los registra).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { kv } = await import('@vercel/kv');

  // Usa el mismo candado que /api/inbox: si el agente esta trabajando la cola
  // no tocamos nada (limpiar a mitad de su ciclo desordenaria sus confirmaciones).
  const gotLock = await kv.set('whatsapp:lock', 'pending:' + Date.now(), { nx: true, ex: 60 });
  if (!gotLock) {
    return res.status(200).json({ busy: true, actionable: 0, dropped: 0 });
  }

  try {
    const raw = await kv.lrange('whatsapp:inbox', 0, -1);
    const drop = [];
    const cache = {};
    let actionable = 0;

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

      const benignStatus =
        parsed.kind === 'status' &&
        !parsed.errors &&
        ['sent', 'delivered', 'read'].includes(parsed.status);

      if (filtered || benignStatus) {
        drop.push(typeof item === 'string' ? item : JSON.stringify(item));
      } else {
        actionable++;
      }
    }

    let dropped = 0;
    if (drop.length) {
      const p = kv.pipeline();
      for (const s of drop) p.lrem('whatsapp:inbox', 1, s);
      const results = await p.exec();
      dropped = results.reduce((sum, r) => sum + (Number(r) || 0), 0);
    }

    return res.status(200).json({ busy: false, actionable, dropped });
  } finally {
    // Se libera siempre: si hay trabajo, el agente tomara el candado enseguida.
    await kv.del('whatsapp:lock');
  }
}
