/* Ledgerline — shared client shell */
(function () {
  const CUR = window.__CURRENCY__ || '$';

  const ICONS = {
    dashboard: '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
    transactions: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    rules: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7.9a2 2 0 0 1 1.4.6l6.2 6.2a2 2 0 0 1 0 2.8Z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
    reports: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
    assistant: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
    import: '<path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.61.79 1.02 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    logo: '<path d="M4 7h16M4 12h10M4 17h16"/>',
    up: '<path d="M7 17 17 7M17 7H8M17 7v9"/>',
    down: '<path d="M17 7 7 17M7 17h9M7 17V8"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    upload: '<path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };
  function svg(name, w) {
    w = w || 18;
    return `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  const NAV = [
    ['/', 'dashboard', 'Dashboard'],
    ['/transactions', 'transactions', 'Transactions'],
    ['/rules', 'rules', 'Categories & Rules'],
    ['/reports', 'reports', 'Reports'],
    ['/assistant', 'assistant', 'Assistant'],
    ['/import', 'import', 'Import CSV'],
    ['#', 'settings', 'Settings'],
  ];

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
      ...opts,
      body: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    if (res.status === 401) { location.href = '/login'; throw new Error('Not signed in'); }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n, cents) => `${CUR}${(cents ? nf2 : nf0).format(Math.abs(Number(n) || 0))}`;
  const signedMoney = (n, cents) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${money(n, cents)}`;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const CAT_VAR = {
    Housing: '--c-housing', Groceries: '--c-groceries', Dining: '--c-dining', Transport: '--c-transport',
    Shopping: '--c-shopping', Utilities: '--c-utilities', Entertainment: '--c-entertainment', Health: '--c-health',
    Travel: '--c-travel', Subscriptions: '--c-subscriptions', Education: '--c-education', Misc: '--c-misc',
    Income: '--c-income', Uncategorized: '--c-uncategorized',
  };
  const catColor = (c) => `var(${CAT_VAR[c] || '--c-other'})`;

  let toastBox;
  function toast(msg, isErr) {
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.id = 'toasts'; document.body.appendChild(toastBox); }
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    toastBox.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3600);
    setTimeout(() => el.remove(), 4000);
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // Ledgerline mark: three ledger lines, each entry coloured like the rest of the site
  // (mint = money in, amber = money out). Keep in sync with assets/favicon.svg and the auth pages.
  const logo = (w) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h3" stroke="#3ddc97"/><path d="M10.5 7H20" stroke="#eef1f6"/><path d="M4 12h3" stroke="#f0883e"/><path d="M10.5 12H14" stroke="#eef1f6"/><path d="M4 17h3" stroke="#3ddc97"/><path d="M10.5 17H20" stroke="#eef1f6"/></svg>`;

  async function mountShell(active) {
    const side = document.getElementById('side');
    if (!side) return;
    side.innerHTML = `
      <div class="brand"><span class="mark">${logo(16)}</span><b>Ledgerline</b></div>
      <nav>${NAV.map(([href, icon, label]) => `<a href="${href}" class="${icon === active ? 'active' : ''}">${svg(icon)} ${label}</a>`).join('')}</nav>
      <div class="side-foot">
        <div class="who"><div class="avatar" id="uav">··</div><div class="meta"><div id="uname">…</div><div id="uemail"></div></div></div>
        <button class="linkbtn" id="logout">Sign out</button>
      </div>`;
    document.getElementById('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/login'; };
    try {
      const { user } = await api('/api/me');
      document.getElementById('uname').textContent = user.name;
      document.getElementById('uemail').textContent = user.demo ? 'Sandbox account' : user.email;
      document.getElementById('uav').textContent = (user.name || user.email).slice(0, 2).toUpperCase();
      if (user.demo) {
        const main = document.getElementById('main');
        if (main && !main.querySelector('.demo-banner')) {
          main.insertAdjacentHTML('afterbegin',
            `<div class="demo-banner"><span><b>Demo sandbox.</b> Everything here is sample data that only you can see. Feel free to import, edit and ask questions; it is cleared after a day.</span><a href="/signup">Create an account</a></div>`);
        }
      }
    } catch { /* redirected */ }
  }

  window.LL = { api, money, signedMoney, esc, catColor, toast, debounce, svg, icon: svg, logo, mountShell, CUR };
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page) mountShell(document.body.dataset.page);
  });
})();
