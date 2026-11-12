function authForm(endpoint) {
  const form = document.getElementById('f');
  const err = document.getElementById('err');
  const btn = form.querySelector('button[type=submit]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      location.href = '/';
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}

// One-click demo (server has DEMO_MODE=true): a private sandbox account filled with sample data.
(function () {
  const box = document.getElementById('demo-box');
  const demo = document.getElementById('demo');
  if (!box || !demo || !window.__DEMO__) return;
  box.hidden = false;
  // the cloud-AI disclosure is only shown when the server actually has the demo AI turned on
  document.querySelectorAll('[data-demo-ai-only]').forEach((e) => { e.hidden = !window.__DEMO_AI__; });
  document.querySelectorAll('[data-demo-builtin-only]').forEach((e) => { e.hidden = !!window.__DEMO_AI__; });
  const label = demo.textContent;
  const reset = () => { demo.disabled = false; demo.textContent = label; };
  demo.addEventListener('click', async () => {
    const err = document.getElementById('err');
    err.textContent = '';
    demo.disabled = true;
    demo.textContent = 'Setting up your sandbox…';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000); // never sit on "Setting up…" forever
    try {
      const res = await fetch('/api/demo', { method: 'POST', signal: abort.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the demo.');
      location.href = '/';
    } catch (ex) {
      err.textContent = ex.name === 'AbortError' ? 'The demo is taking too long. Please try again.' : ex.message;
      reset();
    } finally {
      clearTimeout(timer);
    }
  });
  // Coming back with the Back button restores this page from the browser's cache exactly as it was
  // left, including a disabled "Setting up…" button. Put the buttons back.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    reset();
    document.querySelectorAll('button[type=submit]').forEach((b) => { b.disabled = false; });
  });
})();
