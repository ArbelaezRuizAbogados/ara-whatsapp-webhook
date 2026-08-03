export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(HTML);
}

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Conversaciones - Arbelaez Ruiz Abogados</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #f3f2ee; color: #1b2a4a; }
  #gate { display: flex; align-items: center; justify-content: center; height: 100vh; }
  #gate form { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.15); width: 280px; }
  #gate input { width: 100%; padding: 10px; margin: 12px 0; border: 1px solid #ccc; border-radius: 4px; }
  #gate button, .send-btn { background: #1b2a4a; color: #fff; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; width: 100%; }
  #app { display: none; height: 100vh; }
  #sidebar { width: 300px; background: #fff; border-right: 1px solid #ddd; overflow-y: auto; flex-shrink: 0; }
  .contact { padding: 12px 14px; border-bottom: 1px solid #eee; cursor: pointer; }
  .contact:hover { background: #f7f6f2; }
  .contact.active { background: #eef1f8; }
  .contact .num { font-weight: 600; font-size: 13.5px; }
  .contact .prev { font-size: 12px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .badge { display: inline-block; font-size: 10px; padding: 2px 7px; border-radius: 10px; margin-top: 4px; }
  .badge.human { background: #f8e3c2; color: #7a4a00; }
  .badge.auto { background: #d9ecdc; color: #1e6b2e; }
  #main { flex: 1; display: flex; flex-direction: column; }
  #thread-header { padding: 14px 18px; background: #fff; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
  #thread { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .bubble { max-width: 65%; padding: 8px 12px; border-radius: 10px; font-size: 14px; line-height: 1.4; }
  .bubble.in { align-self: flex-start; background: #fff; border: 1px solid #e0e0e0; }
  .bubble.out { align-self: flex-end; background: #1b2a4a; color: #fff; }
  .bubble.out.human { background: #c9a227; }
  .meta { font-size: 10px; opacity: 0.65; margin-top: 4px; }
  #replybar { display: flex; gap: 8px; padding: 12px; background: #fff; border-top: 1px solid #ddd; }
  #replybar input { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px; }
  #takeover-bar { padding: 8px 18px; background: #fdf3e0; font-size: 12.5px; display: none; align-items: center; justify-content: space-between; }
  #takeover-bar button { background: none; border: 1px solid #7a4a00; color: #7a4a00; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  #toggle-btn { border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 12.5px; border: 1px solid #1b2a4a; background: #fff; color: #1b2a4a; }
  #toggle-btn.is-human { border-color: #7a4a00; color: #7a4a00; }
  #empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #999; }
  #back-btn { display: none; }
  @media (max-width: 700px) {
    #sidebar { width: 92px; }
    .contact { padding: 8px 6px; text-align: center; }
    .contact .num { font-size: 10.5px; word-break: break-all; }
    .contact .prev { display: none; }
    .badge { font-size: 8.5px; padding: 1px 4px; }
    #thread-header { padding: 8px 10px; }
    #th-name { font-size: 13px; }
    #th-num { font-size: 10px; }
    #toggle-btn { font-size: 10.5px; padding: 5px 8px; }
    #thread { padding: 10px; }
    .bubble { max-width: 88%; font-size: 13px; }
    #replybar { padding: 8px; }
  }
</style>
</head>
<body>

<div id="gate">
  <form id="gate-form">
    <div style="font-weight:700; margin-bottom:8px;">Conversaciones - Arbelaez Ruiz</div>
    <input type="password" id="pw" placeholder="Clave de acceso" required />
    <button type="submit">Entrar</button>
    <div id="gate-error" style="color:#b00; font-size:12px; margin-top:8px;"></div>
  </form>
</div>

<div id="app" style="display:none;">
  <div id="sidebar"></div>
  <div id="main">
    <div id="thread-header" style="display:none;">
      <div>
        <div id="th-name" style="font-weight:600;"></div>
        <div id="th-num" style="font-size:12px; color:#777;"></div>
      </div>
      <button id="toggle-btn"></button>
    </div>
    <div id="takeover-bar">
      <span>Estas respondiendo tu, el agente no le va a escribir a este contacto.</span>
      <button id="release-btn">Devolver control al agente</button>
    </div>
    <div id="thread"></div>
    <div id="empty">Selecciona un contacto</div>
    <div id="replybar" style="display:none;">
      <input type="text" id="reply-input" placeholder="Escribe una respuesta..." />
      <button class="send-btn" id="reply-send" style="width:auto;">Enviar</button>
    </div>
  </div>
</div>

<script>
let SECRET = '';
let CURRENT = null;
let CURRENT_TAKEOVER = false;

document.getElementById('gate-form').addEventListener('submit', function(e) {
  e.preventDefault();
  SECRET = document.getElementById('pw').value;
  loadContacts().then(function(ok) {
    if (ok) {
      document.getElementById('gate').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
    } else {
      document.getElementById('gate-error').textContent = 'Clave incorrecta';
    }
  });
});

function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'x-poll-secret': SECRET, 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(path, opts);
}

function loadContacts() {
  return api('/api/threads').then(function(r) {
    if (!r.ok) return false;
    return r.json().then(function(data) {
      renderSidebar(data.contacts || []);
      return true;
    });
  }).catch(function() { return false; });
}

function renderSidebar(contacts) {
  const el = document.getElementById('sidebar');
  el.innerHTML = '';
  contacts.forEach(function(c) {
    const div = document.createElement('div');
    div.className = 'contact' + (CURRENT === c.number ? ' active' : '');
    const preview = c.last ? c.last.text : '';
    div.innerHTML = '<div class="num">' + c.number + '</div>' +
      '<div class="prev">' + escapeHtml(preview) + '</div>' +
      '<span class="badge ' + (c.takeover ? 'human' : 'auto') + '">' + (c.takeover ? 'Control humano' : 'Agente activo') + '</span>';
    div.addEventListener('click', function() { openThread(c.number); });
    el.appendChild(div);
  });
}

function openThread(number) {
  CURRENT = number;
  api('/api/threads?number=' + encodeURIComponent(number)).then(function(r) { return r.json(); }).then(function(data) {
    document.getElementById('empty').style.display = 'none';
    document.getElementById('thread-header').style.display = 'flex';
    document.getElementById('replybar').style.display = 'flex';
    document.getElementById('th-name').textContent = number;
    document.getElementById('th-num').textContent = data.takeover ? 'Control humano activo' : 'Respondido por el agente';
    document.getElementById('takeover-bar').style.display = data.takeover ? 'flex' : 'none';
    CURRENT_TAKEOVER = !!data.takeover;
    const toggleBtn = document.getElementById('toggle-btn');
    toggleBtn.textContent = CURRENT_TAKEOVER ? 'Reactivar agente' : 'Pausar agente aqui';
    toggleBtn.className = CURRENT_TAKEOVER ? 'is-human' : '';

    const thread = document.getElementById('thread');
    thread.innerHTML = '';
    (data.messages || []).forEach(function(m) {
      const b = document.createElement('div');
      b.className = 'bubble ' + (m.direction === 'out' ? 'out' : 'in') + (m.sender === 'human' ? ' human' : '');
      const time = new Date(Number(m.timestamp) * 1000).toLocaleString('es-CO');
      b.innerHTML = escapeHtml(m.text) + '<div class="meta">' + (m.direction === 'out' ? (m.sender === 'human' ? 'Tu' : 'Agente') + ' - ' : '') + time + '</div>';
      thread.appendChild(b);
    });
    thread.scrollTop = thread.scrollHeight;
    loadContacts();
  });
}

document.getElementById('reply-send').addEventListener('click', sendReply);
document.getElementById('reply-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') sendReply();
});

function sendReply() {
  const input = document.getElementById('reply-input');
  const text = input.value.trim();
  if (!text || !CURRENT) return;
  input.value = '';
  api('/api/send', {
    method: 'POST',
    body: JSON.stringify({ to: CURRENT, message: text, sender: 'human' }),
  }).then(function() { openThread(CURRENT); });
}

document.getElementById('release-btn').addEventListener('click', function() {
  if (!CURRENT) return;
  api('/api/takeover', {
    method: 'POST',
    body: JSON.stringify({ to: CURRENT, action: 'release' }),
  }).then(function() { openThread(CURRENT); });
});

document.getElementById('toggle-btn').addEventListener('click', function() {
  if (!CURRENT) return;
  api('/api/takeover', {
    method: 'POST',
    body: JSON.stringify({ to: CURRENT, action: CURRENT_TAKEOVER ? 'release' : 'take' }),
  }).then(function() { openThread(CURRENT); });
});

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

setInterval(function() { if (SECRET) loadContacts(); }, 15000);
</script>
</body>
</html>`;
