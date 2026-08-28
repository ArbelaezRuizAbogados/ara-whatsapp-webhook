async function transcribeAudio(mediaId) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const metaData = await metaRes.json();
  if (!metaRes.ok || !metaData.url) {
    console.error('No se pudo obtener URL de audio:', JSON.stringify(metaData));
    return null;
  }

  const fileRes = await fetch(metaData.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!fileRes.ok) return null;
  const arrayBuffer = await fileRes.arrayBuffer();

  const form = new FormData();
  form.append('file', new Blob([arrayBuffer], { type: metaData.mime_type || 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'es');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: form,
  });
  const whisperData = await whisperRes.json();
  if (!whisperRes.ok) {
    console.error('Error de Whisper:', JSON.stringify(whisperData));
    return null;
  }
  return whisperData.text || null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method === 'POST') {
    // Log temporal de diagnostico: guarda el cuerpo crudo de CADA evento que
    // llega, sin importar el tipo, para poder ver exactamente que envia Meta.
    console.log('Webhook body:', JSON.stringify(req.body));

    try {
      const { kv } = await import('@vercel/kv');
      const entry = req.body?.entry?.[0];
      const value = entry?.changes?.[0]?.value;
      const field = entry?.changes?.[0]?.field;
      const messages = value?.messages || [];
      const statuses = value?.statuses || [];

      console.log('Campo:', field, '| mensajes:', messages.length, '| estados:', statuses.length);

      for (const msg of messages) {
        // Media (audio, imagen, video, documento): Meta solo manda un ID de
        // referencia, no el archivo - queda guardado para descargarlo despues
        // via /api/media cuando el visor lo pida.
        const media = msg.audio || msg.image || msg.video || msg.document || msg.voice || null;

        let transcribedText = null;
        if (media && (msg.type === 'audio' || msg.type === 'voice')) {
          try {
            transcribedText = await transcribeAudio(media.id);
          } catch (err) {
            console.error('Error transcribiendo audio:', err);
          }
        }

        const messageText = msg.text?.body || transcribedText;

        await kv.rpush('whatsapp:inbox', JSON.stringify({
          kind: 'message',
          id: msg.id,
          from: msg.from,
          timestamp: msg.timestamp,
          type: msg.type,
          text: messageText || null,
          transcribed: !!transcribedText,
          button: msg.button || null,
          interactive: msg.interactive || null,
          raw: msg,
          received_at: new Date().toISOString(),
        }));

        // Historial permanente para el visor (no se borra al consumir /api/inbox).
        await kv.rpush(`whatsapp:thread:${msg.from}`, JSON.stringify({
          direction: 'in',
          sender: 'customer',
          text: messageText || `[${msg.type}]`,
          transcribed: !!transcribedText,
          button: msg.button?.text || msg.interactive?.button_reply?.title || null,
          media_id: media?.id || null,
          media_mime_type: media?.mime_type || null,
          media_type: media ? msg.type : null,
          timestamp: msg.timestamp,
          received_at: new Date().toISOString(),
        }));
        await kv.zadd('whatsapp:contacts', { score: Number(msg.timestamp), member: msg.from });
      }

      for (const st of statuses) {
        await kv.rpush('whatsapp:inbox', JSON.stringify({
          kind: 'status',
          message_id: st.id,
          recipient_id: st.recipient_id,
          status: st.status,
          timestamp: st.timestamp,
          errors: st.errors || null,
          received_at: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.error('Error guardando evento de WhatsApp:', err);
    }

    res.status(200).send('EVENT_RECEIVED');
    return;
  }

  res.status(405).send('Method Not Allowed');
}
