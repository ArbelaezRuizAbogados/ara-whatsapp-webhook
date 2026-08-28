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
  // (eso causaba respuestas duplicadas). Expira solo a los 10 min por si un
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

  for (const item of raw) {
    const parsed = typeof item === 'string' ? JSON.parse(item) : item;

    // Si el contacto esta bajo control humano o bloqueado, no se le entrega
    // al agente - ya quedo guardado en el historial (whatsapp:thread) para
    // el visor, pero nadie le responde automaticamente.
    const contact = parsed.from || parsed.recipient_id;
    if (contact) {
      const takenOver = await kv.get(`whatsapp:takeover:${contact}`);
      if (takenOver) continue;
      const blocked = await kv.get(`whatsapp:blocked:${contact}`);
      if (blocked) continue;
    }

    messages.push(parsed);
  }

  res.status(200).json({ messages, count: raw.length });
}
