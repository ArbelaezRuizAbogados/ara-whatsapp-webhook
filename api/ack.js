export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { count, release } = req.body || {};
  if (!Number.isInteger(count) || count < 0) {
    return res.status(400).json({ error: 'Falta "count" (numero entero) - normalmente 1, uno por mensaje.' });
  }

  const { kv } = await import('@vercel/kv');
  // Quita del frente de la cola exactamente los "count" mensajes que ya se
  // leyeron y procesaron. Cualquier mensaje nuevo que haya llegado despues
  // (al final de la cola) queda intacto para el proximo ciclo.
  for (let i = 0; i < count; i++) {
    await kv.lpop('whatsapp:inbox');
  }

  // El candado de /api/inbox solo se libera cuando el agente avisa
  // explicitamente que termino todo el ciclo (release: true) - asi ningun
  // otro proceso (otra corrida programada o manual) puede leer/responder la
  // cola mientras este siga trabajando en el resto de los mensajes.
  if (release) {
    await kv.del('whatsapp:lock');
  }

  res.status(200).json({ success: true, removed: count, lock_released: !!release });
}
