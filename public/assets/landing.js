(function () {
  const all = (s) => document.querySelectorAll(s);
  const gh = String(window.__GITHUB__ || '').replace(/\/+$/, '');

  // GitHub links come from the server (GITHUB_URL), so a fork can point them at its own repo
  all('[data-github]').forEach((a) => { a.href = gh || '#'; });
  all('[data-github-fork]').forEach((a) => { a.href = gh ? gh + '/fork' : '#'; });
  all('[data-clone-url]').forEach((s) => { if (gh) s.textContent = gh + '.git'; });

  // demo-only sites have no accounts, so hide every sign-in / create-account link
  if (window.__DEMO_ONLY__) all('[data-accounts]').forEach((e) => { e.hidden = true; });

  // demo: one click creates a private sandbox with sample data (server needs DEMO_MODE=true)
  if (!window.__DEMO__) all('[data-demo], [data-demo-only]').forEach((e) => { e.hidden = true; });
  all('[data-demo-ai-only]').forEach((e) => { e.hidden = !window.__DEMO_AI__; });
  all('[data-demo-builtin-only]').forEach((e) => { e.hidden = !!window.__DEMO_AI__; });

  const buttons = Array.from(all('[data-demo]'));
  const labels = new Map(buttons.map((b) => [b, b.textContent]));
  const showError = (msg) => all('.lp-err').forEach((e) => { e.textContent = msg; });
  const reset = () => buttons.forEach((b) => { b.disabled = false; b.textContent = labels.get(b); });

  async function startDemo() {
    showError('');
    buttons.forEach((b) => { b.disabled = true; b.textContent = 'Setting up your sandbox…'; });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000); // never sit on "Setting up…" forever
    try {
      const res = await fetch('/api/demo', { method: 'POST', signal: abort.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the demo.');
      location.href = '/';
    } catch (ex) {
      showError(ex.name === 'AbortError' ? 'The demo is taking too long. Please try again.' : ex.message);
      reset();
    } finally {
      clearTimeout(timer);
    }
  }
  buttons.forEach((b) => b.addEventListener('click', startDemo));
  // the Back button restores this page from the browser cache with the buttons still disabled
  window.addEventListener('pageshow', (e) => { if (e.persisted) reset(); });

  // copy the run-it-locally commands
  const copy = document.getElementById('copy-clone');
  const cmd = document.getElementById('clone-cmd');
  if (copy && cmd) {
    copy.addEventListener('click', async () => {
      const text = cmd.textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea'); // older browsers / non-secure origins
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } finally { ta.remove(); }
      }
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
    });
  }
})();
