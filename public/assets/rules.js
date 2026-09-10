(function () {
  const { api, esc, catColor, toast, svg } = window.LL;
  const $ = (s) => document.querySelector(s);
  let CATS = [];

  async function loadRules() {
    const { rows, categories } = await api('/api/rules');
    if (!CATS.length) {
      CATS = categories.filter((c) => c !== 'Uncategorized');
      $('#rule-cat').innerHTML = CATS.map((c) => `<option>${c}</option>`).join('');
    }
    const tb = $('#rules-tbl tbody');
    tb.innerHTML = rows.length
      ? rows
          .map((r) => `<tr>
            <td class="mono">${esc(r.match_text)}</td>
            <td><span class="pill" style="color:${catColor(r.category)};background:rgba(148,165,182,0.12)">${esc(r.category)}</span></td>
            <td class="num mono muted">${r.matches}</td>
            <td class="num" style="width:34px;"><button class="linkbtn del" data-id="${r.id}" style="color:var(--text-4)">${svg('trash', 15)}</button></td>
          </tr>`)
          .join('')
      : `<tr><td colspan="4" class="empty">No rules yet. Add one below, or recategorize a transaction and follow the tip.</td></tr>`;
    tb.querySelectorAll('.del').forEach((b) => (b.onclick = async () => {
      await api('/api/rules/' + b.dataset.id, { method: 'DELETE' });
      toast('Rule removed.');
      loadRules();
    }));
  }

  async function loadQueue() {
    const { rows } = await api('/api/uncategorized');
    $('#uc-count').textContent = rows.length;
    const list = $('#uc-list');
    if (!rows.length) { list.innerHTML = '<div class="empty">Nothing waiting — every transaction is sorted.</div>'; return; }
    list.innerHTML = rows
      .slice(0, 12)
      .map((r) => `<div style="padding:11px 15px;border-bottom:1px solid var(--hair);display:flex;flex-direction:column;gap:7px;">
        <span class="mono" style="font-size:12px;">${esc(r.merchant || r.note || '—')}</span>
        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <span class="muted" style="font-size:11.5px;">suggests</span>
          <select data-id="${r.id}" class="uc-sel" style="font-size:12px;padding:3px 7px;">${['Uncategorized', ...CATS].map((c) => `<option ${c === (r.guess || 'Uncategorized') ? 'selected' : ''}>${c}</option>`).join('')}</select>
          ${r.confidence ? `<span class="mono muted" style="font-size:11px;">${r.confidence}%</span>` : ''}
          <button class="chip uc-ok" data-id="${r.id}" style="margin-left:auto;color:var(--mint);border-color:var(--mint-line);">Apply</button>
        </div>
      </div>`)
      .join('');
    list.querySelectorAll('.uc-ok').forEach((b) => (b.onclick = async () => {
      const sel = list.querySelector(`.uc-sel[data-id="${b.dataset.id}"]`);
      if (!sel.value || sel.value === 'Uncategorized') return toast('Pick a category first.', true);
      await api('/api/transactions/' + b.dataset.id, { method: 'PATCH', body: { category: sel.value } });
      toast('Sorted & learned.');
      loadQueue(); loadModel(); loadRules();
    }));
  }

  async function loadModel() {
    const m = await api('/api/model');
    $('#model-stats').textContent = `${m.corrections} corrections learned · ${m.autoMatchRate == null ? '—' : m.autoMatchRate + '%'} auto-match rate`;
  }

  $('#rule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { match_text: fd.get('match_text'), category: fd.get('category'), applyExisting: fd.get('applyExisting') === 'on' };
    if (!body.match_text || body.match_text.trim().length < 2) return toast('Enter at least 2 characters.', true);
    try {
      const { updated } = await api('/api/rules', { method: 'POST', body });
      toast(updated ? `Rule added — ${updated} existing transaction(s) recategorized.` : 'Rule added.');
      e.target.reset();
      loadRules(); loadQueue(); loadModel();
    } catch (ex) { toast(ex.message, true); }
  });

  async function loadSemantic() {
    const badge = $('#sem-badge');
    const stats = $('#sem-stats');
    const btn = $('#sem-build');
    try {
      const s = await api('/api/embed/status');
      if (!s.enabled) {
        badge.textContent = 'off';
        stats.textContent = 'Set EMBED_ENABLED=true and restart.';
        btn.hidden = true;
        return;
      }
      if (s.reachable === false) {
        badge.textContent = 'no model';
        badge.style.color = 'var(--amber)';
        stats.textContent = s.error ? String(s.error).slice(0, 90) : 'Ollama / embed model unreachable.';
        btn.hidden = true;
        return;
      }
      badge.textContent = 'on';
      badge.style.background = 'var(--mint-dim)';
      badge.style.color = 'var(--mint)';
      stats.textContent = `${s.model} · ${s.indexed}/${s.total} transactions indexed`;
      btn.hidden = false;
      btn.textContent = s.indexed >= s.total ? 'Rebuild index' : `Build index (${s.total - s.indexed} left)`;
    } catch (e) {
      badge.textContent = '—';
      stats.textContent = e.message;
    }
  }

  $('#sem-build').onclick = async () => {
    const btn = $('#sem-build');
    btn.disabled = true;
    let total = 0;
    const t0 = Date.now();
    try {
      // the server bounds each call; loop until nothing is left
      for (let pass = 0; pass < 200; pass++) {
        btn.textContent = total ? `Building… (${total})` : 'Building…';
        const r = await api('/api/embed/reindex', { method: 'POST', body: {} });
        total += r.embedded;
        if (!r.remaining || !r.embedded) break;
      }
      toast(`Indexed ${total} transaction(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
    } catch (e) {
      toast(e.message, true);
    }
    btn.disabled = false;
    loadSemantic();
  };

  Promise.all([loadRules(), loadModel()]).then(loadQueue).then(loadSemantic).catch((e) => toast(e.message, true));
})();
