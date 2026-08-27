export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { count } = req.body || {};
  if (!Number.isInteger(count) || count < 0) {
    return res.status(400).json({ error: 'Falta "count" (numero entero) - el mismo valor que devolvio GET /api/inbox.' });
  }

  const { kv } = await import('@vercel/kv');
  // Quita del frente de la cola exactamente los "count" mensajes que ya se
  // leyeron y procesaron. Cualquier mensaje nuevo que haya llegado despues
  // (al final de la cola) queda intacto para el proximo ciclo.
  for (let i = 0; i < count; i++) {
    await kv.lpop('whatsapp:inbox');
  }

  res.status(200).json({ success: true, removed: count });
}
