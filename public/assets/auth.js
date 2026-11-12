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
  demo.addEventListener('click', async () => {
    const err = document.getElementById('err');
    err.textContent = '';
    demo.disabled = true;
    demo.textContent = 'Setting up your sandbox…';
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the demo.');
      location.href = '/';
    } catch (ex) {
      err.textContent = ex.message;
      demo.disabled = false;
      demo.textContent = 'Explore with sample data';
    }
  });
})();
