export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { kv } = await import('@vercel/kv');

  // Candado: solo un proceso a la vez puede estar leyendo/respondiendo la
  // cola. Si ya hay uno activo (otra corrida programada o manual en curso),
  // se avisa en vez de entregar los mismos mensajes a dos procesos a la vez
  // (eso causaba respuestas duplicadas). Expira solo a los 15 min por si un
  // proceso se cuelga y nunca llama a /api/ack para liberarlo.
  const gotLock = await kv.set('whatsapp:lock', String(Date.now()), { nx: true, ex: 900 });
  if (!gotLock) {
    return res.status(200).json({ messages: [], count: 0, locked: true });
  }

  // Lectura NO destructiva: los mensajes se quedan en la cola hasta que el
  // agente confirme haberlos procesado con POST /api/ack. Si el agente se
  // cuelga o falla antes de confirmar, el siguiente ciclo los vuelve a ver -
  // nunca se pierden en silencio. (El historial permanente en whatsapp:thread
  // nunca se borra, sin importar lo que pase aqui.)
  const raw = await kv.lrange('whatsapp:inbox', 0, -1);
  const messages = [];
  const drop = [];
  const cache = {};

  for (const item of raw) {
    const parsed = typeof item === 'string' ? JSON.parse(item) : item;

    // Contactos bloqueados o bajo control humano: el agente nunca debe verlos.
    // Se SACAN de la cola (no solo se ocultan): /api/ack confirma por posicion
    // desde el frente de la lista, asi que si estos eventos se quedaran
    // adelante, cada confirmacion borraria uno de ellos en lugar del mensaje
    // que el agente acaba de atender, y el real volveria a aparecer una y otra
    // vez. Ya quedaron guardados en el historial (whatsapp:thread) del visor.
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
      messages.push(parsed);
    }
  }

  let removed = 0;
  if (drop.length) {
    const p = kv.pipeline();
    for (const s of drop) p.lrem('whatsapp:inbox', 1, s);
    const results = await p.exec();
    removed = results.reduce((sum, r) => sum + (Number(r) || 0), 0);
  }

  res.status(200).json({ messages, count: raw.length - removed, purged: removed });
}
