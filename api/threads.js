export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'] || req.query.secret;
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { kv } = await import('@vercel/kv');
  const contacts = await kv.zrange('whatsapp:contacts', 0, -1, { rev: true });

  const single = req.query.number;
  if (single) {
    const raw = await kv.lrange(`whatsapp:thread:${single}`, 0, -1);
    const messages = raw.map((m) => (typeof m === 'string' ? JSON.parse(m) : m));
    const takeover = !!(await kv.get(`whatsapp:takeover:${single}`));
    const blocked = !!(await kv.get(`whatsapp:blocked:${single}`));
    return res.status(200).json({ number: single, takeover, blocked, messages });
  }

  const list = [];
  for (const number of contacts) {
    const raw = await kv.lrange(`whatsapp:thread:${number}`, -1, -1);
    const last = raw[0] ? (typeof raw[0] === 'string' ? JSON.parse(raw[0]) : raw[0]) : null;
    const takeover = !!(await kv.get(`whatsapp:takeover:${number}`));
    const blocked = !!(await kv.get(`whatsapp:blocked:${number}`));
    list.push({ number, last, takeover, blocked });
  }

  res.status(200).json({ contacts: list });
}
