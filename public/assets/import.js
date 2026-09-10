(function () {
  const { api, money, esc, toast } = window.LL;
  const $ = (s) => document.querySelector(s);

  let csvText = '';
  let fileName = '';
  let headers = [];
  let mapping = {};
  const FIELDS = [
    ['date', 'Date', true],
    ['amount', 'Amount', false],
    ['debit', 'Debit column', false],
    ['credit', 'Credit column', false],
    ['description', 'Description', true],
    ['category', 'Category (optional)', false],
    ['type', 'Type (optional)', false],
  ];

  function setStep(n) {
    $('#step1').style.display = n === 1 ? '' : 'none';
    $('#step2').style.display = n === 2 ? 'flex' : 'none';
    $('#step2').style.flexDirection = 'column';
    $('#step2').style.gap = '18px';
    $('#step3').style.display = n === 3 ? '' : 'none';
    $('#footer').style.display = n === 2 ? '' : 'none';
    document.querySelectorAll('#steps span[data-s]').forEach((el) => {
      const s = Number(el.dataset.s);
      el.style.color = s <= n ? '' : 'var(--text-3)';
      const b = el.querySelector('.step-n');
      if (b) { b.style.background = s <= n ? 'var(--mint)' : 'var(--panel-2)'; b.style.color = s <= n ? '#06251a' : 'var(--text-3)'; b.style.borderRadius = '50%'; b.style.padding = '1px 6px'; b.style.border = s <= n ? 'none' : '1px solid var(--line-2)'; }
    });
  }

  async function preview(text, name) {
    csvText = text;
    fileName = name || 'pasted.csv';
    try {
      const p = await api('/api/import/preview', { method: 'POST', body: { csv: text } });
      headers = p.headers;
      mapping = p.mapping || {};
      $('#file-name').textContent = `${fileName} · ${p.totalRows} rows`;
      renderMapping();
      renderPreview(p.sample);
      $('#pos').parentElement.style.display = mapping.amount ? '' : 'none';
      setStep(2);
      updateFoot();
    } catch (e) { toast(e.message, true); }
  }

  function renderMapping() {
    $('#mapping').innerHTML = FIELDS.map(([key, label]) => {
      const opts = ['<option value="">— none —</option>']
        .concat(headers.map((h) => `<option value="${esc(h)}" ${mapping[key] === h ? 'selected' : ''}>${esc(h)}</option>`))
        .join('');
      return `<div class="row" style="gap:12px;">
        <span style="width:150px;font-size:13px;color:var(--text-2);">${label}</span>
        <span style="color:var(--text-4);">←</span>
        <select data-key="${key}" style="flex:1;font-size:12.5px;" class="map-sel">${opts}</select>
      </div>`;
    }).join('');
    $('#mapping').querySelectorAll('.map-sel').forEach((sel) => {
      sel.onchange = () => { mapping[sel.dataset.key] = sel.value || null; updateFoot(); refreshPreview(); };
    });
  }

  async function refreshPreview() {
    try {
      const p = await api('/api/import/preview', {
        method: 'POST',
        body: { csv: csvText, mapping, positiveMeans: $('#pos').value },
      });
      renderPreview(p.sample);
    } catch { /* ignore */ }
  }

  function renderPreview(sample) {
    const rows = (sample || []).slice(0, 5);
    $('#preview').innerHTML =
      `<thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Type</th><th>Category</th></tr></thead><tbody>` +
      rows
        .map((r) => {
          const p = r.parsed;
          if (!p) return `<tr><td colspan="5" class="muted">— row skipped (unrecognized) —</td></tr>`;
          return `<tr>
            <td class="mono" style="font-size:12px;">${esc(p.date)}</td>
            <td class="mono" style="font-size:12px;">${esc(p.description).slice(0, 40)}</td>
            <td class="num mono ${p.type === 'income' ? 'pos' : ''}" style="font-size:12px;">${p.type === 'income' ? '+' : '−'}${money(p.amount, true)}</td>
            <td style="font-size:12px;">${p.type}</td>
            <td style="font-size:12px;">${p.csvCategory ? esc(p.csvCategory) : '<span class="muted">auto</span>'}</td>
          </tr>`;
        })
        .join('') +
      `</tbody>`;
  }

  function updateFoot() {
    const ok = mapping.date && (mapping.amount || mapping.debit || mapping.credit);
    $('#commit').disabled = !ok;
    $('#foot-info').textContent = ok ? 'Ready to import. Duplicates are skipped automatically.' : 'Choose a Date column and an Amount (or Debit/Credit) column.';
  }

  async function commit() {
    $('#commit').disabled = true;
    try {
      const r = await api('/api/import/commit', {
        method: 'POST',
        body: { csv: csvText, mapping, positiveMeans: $('#pos').value },
      });
      const cats = Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]);
      $('#step3').innerHTML = `
        <div style="text-align:center;padding:20px 0;">
          <div style="font-size:26px;font-weight:600;" class="mono pos">${r.inserted}</div>
          <div class="muted">transactions imported</div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr;text-align:center;">
          <div><div class="mono" style="font-size:18px;">${r.duplicates}</div><div class="muted" style="font-size:12px;">duplicates skipped</div></div>
          <div><div class="mono" style="font-size:18px;">${r.uncategorized}</div><div class="muted" style="font-size:12px;">need a category</div></div>
          <div><div class="mono" style="font-size:18px;">${r.skipped}</div><div class="muted" style="font-size:12px;">rows unreadable</div></div>
        </div>
        <div style="margin-top:16px;"><div class="eyebrow" style="margin-bottom:8px;">By category</div>
          <div class="wrap">${cats.map(([c, n]) => `<span class="pill" style="background:var(--panel-2);border:1px solid var(--line);">${esc(c)} · ${n}</span>`).join('')}</div>
        </div>
        <div class="row" style="gap:10px;margin-top:20px;">
          <a class="btn primary" href="/">Open dashboard</a>
          ${r.uncategorized ? '<a class="btn" href="/rules">Sort the uncategorized</a>' : ''}
          <button class="btn ghost" id="again">Import another file</button>
        </div>`;
      $('#footer').hidden = true;
      setStep(3);
      $('#again').onclick = reset;
      toast(`Imported ${r.inserted} transactions.`);
    } catch (e) { toast(e.message, true); $('#commit').disabled = false; }
  }

  function reset() {
    csvText = ''; fileName = ''; headers = []; mapping = {};
    $('#file').value = '';
    setStep(1);
  }

  // wiring
  const fileInput = $('#file');
  fileInput.onchange = () => { const f = fileInput.files[0]; if (f) f.text().then((t) => preview(t, f.name)); };
  const drop = $('#drop');
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = 'var(--mint)'; }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => { drop.style.borderColor = 'var(--line-2)'; }));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) f.text().then((t) => preview(t, f.name));
  });
  document.querySelectorAll('[data-sample]').forEach((a) => {
    a.onclick = async (e) => {
      e.preventDefault();
      const res = await fetch('/assets/' + a.dataset.sample);
      preview(await res.text(), a.dataset.sample);
    };
  });
  $('#restart').onclick = (e) => { e.preventDefault(); reset(); };
  $('#back').onclick = reset;
  $('#commit').onclick = commit;
  $('#pos').onchange = refreshPreview;

  setStep(1);
})();
