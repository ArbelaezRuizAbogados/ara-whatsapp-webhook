export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const secret = req.headers['x-poll-secret'] || req.query.secret;
  if (!secret || secret !== process.env.POLL_SECRET) {
    return res.status(401).send('Unauthorized');
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).send('Falta "id".');
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  try {
    // Paso 1: pedirle a Meta la URL temporal de descarga para este media id.
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const metaData = await metaRes.json();
    if (!metaRes.ok || !metaData.url) {
      console.error('Error obteniendo URL de media:', JSON.stringify(metaData));
      return res.status(404).send('No se pudo obtener el archivo.');
    }

    // Paso 2: descargar el archivo real desde esa URL (tambien requiere token).
    const fileRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      return res.status(502).send('No se pudo descargar el archivo.');
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    res.setHeader('Content-Type', metaData.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).send(buffer);
  } catch (err) {
    console.error('Error en /api/media:', err);
    res.status(500).send('Error interno.');
  }
}
