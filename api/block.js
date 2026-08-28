export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { to, action } = req.body || {};
  if (!to || !['block', 'unblock'].includes(action)) {
    return res.status(400).json({ error: 'Falta "to" o "action" ("block" | "unblock").' });
  }

  const { kv } = await import('@vercel/kv');
  if (action === 'block') {
    await kv.set(`whatsapp:blocked:${to}`, '1');
  } else {
    await kv.del(`whatsapp:blocked:${to}`);
  }

  res.status(200).json({ success: true, to, blocked: action === 'block' });
}
