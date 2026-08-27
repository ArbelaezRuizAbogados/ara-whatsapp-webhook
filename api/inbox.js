export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { kv } = await import('@vercel/kv');
  // Lectura NO destructiva: los mensajes se quedan en la cola hasta que el
  // agente confirme haberlos procesado con POST /api/ack. Si el agente se
  // cuelga o falla antes de confirmar, el siguiente ciclo los vuelve a ver -
  // nunca se pierden en silencio. (El historial permanente en whatsapp:thread
  // nunca se borra, sin importar lo que pase aqui.)
  const raw = await kv.lrange('whatsapp:inbox', 0, -1);
  const messages = [];

  for (const item of raw) {
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

  res.status(200).json({ messages, count: raw.length });
}
