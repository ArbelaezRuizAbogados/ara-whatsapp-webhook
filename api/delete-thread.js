export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'];
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { to } = req.body || {};
  if (!to) {
    return res.status(400).json({ error: 'Falta "to".' });
  }

  const { kv } = await import('@vercel/kv');
  await kv.del(`whatsapp:thread:${to}`);
  await kv.zrem('whatsapp:contacts', to);
  await kv.del(`whatsapp:takeover:${to}`);

  res.status(200).json({ success: true, deleted: to });
}
