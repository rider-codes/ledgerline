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
