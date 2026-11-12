(function () {
  const { api, esc, toast, svg } = window.LL;
  const $ = (s) => document.querySelector(s);
  const thread = $('#thread');
  const input = $('#input');
  const send = $('#send');
  const history = [];

  const STARTERS = [
    'Break down where my money went last month and where I can cut.',
    'Where did I overspend?',
    'Where can I save?',
    'Compare this month to last month',
    'Which subscriptions look unused?',
  ];

  function md(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function add(role, html) {
    const el = document.createElement('div');
    el.className = 'msg ' + (role === 'user' ? 'user' : '');
    el.innerHTML = role === 'user'
      ? `<div class="body">${html}</div>`
      : `<div class="ava" style="color:var(--mint)">${svg('spark', 14)}</div><div class="body">${html}</div>`;
    thread.appendChild(el);
    el.scrollIntoView({ block: 'end' });
    return el;
  }

  function showStarters() {
    add('assistant', `I can see every transaction you've imported. Ask me where the money went or where to trim — for example:`);
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.style.paddingLeft = '38px';
    wrap.innerHTML = STARTERS.map((s) => `<button class="chip">${esc(s)}</button>`).join('');
    wrap.querySelectorAll('.chip').forEach((b) => (b.onclick = () => ask(b.textContent)));
    thread.appendChild(wrap);
  }

  async function ask(msg) {
    msg = (msg || '').trim();
    if (!msg) return;
    input.value = '';
    autoGrow();
    add('user', esc(msg));
    history.push({ role: 'user', content: msg });
    send.disabled = true;
    const pending = add('assistant', '<span class="muted">Thinking…</span>');
    const body = pending.querySelector('.body');
    const t0 = Date.now();
    let acc = '';
    let note = '';
    const tick = setInterval(() => {
      if (!acc) body.innerHTML = `<span class="muted">Thinking… ${Math.round((Date.now() - t0) / 1000)}s</span>`;
    }, 1000);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg, history: history.slice(-8) }),
      });
      if (res.status === 401) { location.href = '/login'; return; }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let ended = false;
      while (!ended) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          if (!frame.startsWith('data:')) continue; // skip ": keep-alive" comments
          let ev;
          try { ev = JSON.parse(frame.slice(5).trim()); } catch { continue; }
          if (ev.type === 'delta') {
            acc += ev.text;
            body.innerHTML = esc(acc).replace(/\n/g, '<br>');
            pending.scrollIntoView({ block: 'end' });
          } else if (ev.type === 'note') {
            note = ev.text;
          } else if (ev.type === 'error') {
            throw new Error(ev.text);
          } else if (ev.type === 'done') {
            ended = true;
          }
        }
      }

      body.innerHTML = (acc ? md(acc) : '<span class="muted">No answer.</span>')
        + (note ? `<br><span class="muted" style="font-size:11.5px;">${esc(note)}</span>` : '');
      if (acc) history.push({ role: 'assistant', content: acc });
    } catch (e) {
      body.innerHTML = acc
        ? md(acc) + `<br><span class="neg" style="font-size:11.5px;">${esc(e.message)}</span>`
        : `<span class="neg">${esc(e.message)}</span>`;
    } finally {
      clearInterval(tick);
      send.disabled = false;
      input.focus();
      refreshPill();
    }
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
  }

  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); }
  });
  send.onclick = () => ask(input.value);

  $('#chips').innerHTML = STARTERS.slice(1, 4).map((s) => `<button class="chip">${esc(s)}</button>`).join('');
  $('#chips').querySelectorAll('.chip').forEach((b) => (b.onclick = () => ask(b.textContent)));

  // The pill shows which engine answers. In the demo it also counts the AI questions left today.
  function refreshPill() {
    return api('/api/chat/config').then((c) => {
      const dot = c.backend === 'rules' ? '' : `<span class="dot" style="width:6px;height:6px;border-radius:50%;background:var(--mint);margin-right:6px;"></span>`;
      let label;
      if (c.demo && c.backend !== 'rules') label = `AI · ${c.demo.remaining} of ${c.demo.limit} left`;
      else if (c.demo) label = 'built-in analysis · AI limit reached';
      else label = c.backend === 'rules' ? 'built-in analysis' : (c.backend === 'ollama' ? 'local · ' : '') + esc(c.model);
      $('#model-pill').innerHTML = `${dot}${label}`;
    }).catch(() => {});
  }
  refreshPill();

  showStarters();
  input.focus();
})();
