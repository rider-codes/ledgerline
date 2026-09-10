(function () {
  const { api, money, esc, catColor, toast, debounce, svg } = window.LL;
  const $ = (s) => document.querySelector(s);

  const fmtMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  let CATS = [];
  let filters = { month: '', category: '', type: '', q: '' };

  async function initFilters() {
    const { months, default: def } = await api('/api/months');
    filters.month = def || '';
    $('#f-month').innerHTML = '<option value="">All months</option>' + months.map((m) => `<option value="${m}" ${m === def ? 'selected' : ''}>${fmtMonth(m)}</option>`).join('');
    $('#f-month').onchange = (e) => { filters.month = e.target.value; load(); };
    $('#f-cat').onchange = (e) => { filters.category = e.target.value; load(); };
    $('#f-type').onchange = (e) => { filters.type = e.target.value; load(); };
    $('#q').addEventListener('input', debounce((e) => { filters.q = e.target.value.trim().toLowerCase(); load(); }, 250));
  }

  async function load() {
    const qs = new URLSearchParams();
    if (filters.month) qs.set('month', filters.month);
    if (filters.category) qs.set('category', filters.category);
    if (filters.type) qs.set('type', filters.type);
    qs.set('limit', '400');
    const { rows, total, categories } = await api('/api/transactions?' + qs);
    if (!CATS.length) {
      CATS = categories;
      $('#f-cat').innerHTML = '<option value="">All categories</option>' + ['Income', ...categories].map((c) => `<option>${c}</option>`).join('');
    }
    const shown = filters.q ? rows.filter((r) => (r.merchant + ' ' + r.note).toLowerCase().includes(filters.q)) : rows;
    $('#count').textContent = `${shown.length} of ${total}`;
    renderTable(shown);
    renderSummary();
  }

  function catPill(t) {
    if (t.type === 'income') return `<span class="pill" style="color:var(--mint);background:rgba(61,220,151,0.13)">Income</span>`;
    const opts = CATS.map((c) => `<option ${c === t.category ? 'selected' : ''}>${c}</option>`).join('');
    return `<select data-id="${t.id}" class="cat-sel" style="font-size:12px;padding:4px 8px;color:${catColor(t.category)};background:var(--panel-2);border-color:var(--line-2);">${opts}</select>`;
  }

  function renderTable(rows) {
    const empty = $('#empty');
    const tb = $('#tbl tbody');
    if (!rows.length) { tb.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    let lastDate = '';
    tb.innerHTML = rows
      .map((t) => {
        const head = t.date !== lastDate ? `<tr><td colspan="5" style="border:none;padding-top:16px;"><span class="eyebrow">${new Date(t.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</span></td></tr>` : '';
        lastDate = t.date;
        return `${head}<tr data-id="${t.id}">
          <td style="width:30px;"><span class="dot" style="background:${t.type === 'income' ? 'var(--mint)' : catColor(t.category)};width:8px;height:8px;border-radius:50%;display:inline-block;"></span></td>
          <td>${esc(t.merchant || t.note || '—')}</td>
          <td style="width:170px;">${catPill(t)}</td>
          <td class="num mono">${t.type === 'income' ? '+' : '−'}${money(t.amount, true)}</td>
          <td style="width:34px;"><button class="linkbtn del" data-id="${t.id}" title="Delete" style="color:var(--text-4)">${svg('trash', 15)}</button></td>
        </tr>`;
      })
      .join('');

    tb.querySelectorAll('.cat-sel').forEach((sel) => {
      sel.onchange = async () => {
        try {
          const { ruleSuggestion } = await api(`/api/transactions/${sel.dataset.id}`, { method: 'PATCH', body: { category: sel.value } });
          sel.style.color = catColor(sel.value);
          if (ruleSuggestion) {
            toast(`Learned. Tip: add a rule "${ruleSuggestion.match_text}" → ${ruleSuggestion.category} on the Rules page.`);
          } else toast('Category updated.');
          renderSummary();
        } catch (e) { toast(e.message, true); }
      };
    });
    tb.querySelectorAll('.del').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Delete this transaction?')) return;
        await api(`/api/transactions/${b.dataset.id}`, { method: 'DELETE' });
        toast('Deleted.');
        load();
      };
    });
  }

  async function renderSummary() {
    const box = $('#summary');
    if (!filters.month) { box.innerHTML = '<div class="muted" style="font-size:12px;">Pick a month to see its summary.</div>'; return; }
    const d = await api('/api/dashboard?month=' + filters.month);
    const k = d.kpis;
    const largest = Math.max(0, ...d.categories.map((c) => c.amount));
    const rows = [
      ['Total spent', money(k.spend, true)],
      ['Total income', `<span class="pos">${money(k.income, true)}</span>`],
      ['Net', `<span class="${k.net >= 0 ? 'pos' : 'neg'}">${k.net >= 0 ? '+' : '−'}${money(k.net, true)}</span>`],
      ['Biggest category', `${money(largest, true)}`],
      ['Transactions', k.txnCount],
      ['Uncategorized', k.uncategorized ? `<span class="neg">${k.uncategorized}</span>` : '0'],
    ];
    box.innerHTML = rows.map(([l, v]) => `<div class="spread" style="padding:10px 0;border-bottom:1px solid var(--hair);font-size:13px;"><span class="muted">${l}</span><span class="mono">${v}</span></div>`).join('');
  }

  /* ---- add modal ---- */
  function openAdd() {
    const today = new Date().toISOString().slice(0, 10);
    const root = $('#modal-root');
    root.innerHTML = `<div class="overlay"><div class="modal" style="width:460px;">
      <div class="head"><h2 style="font-size:16px;">Add transaction</h2><button class="x" id="mx">${svg('plus', 18)}</button></div>
      <form class="pad" id="af">
        <div class="grid" style="grid-template-columns:1fr 1fr;">
          <label class="field"><span class="eyebrow">Date</span><input type="date" name="date" value="${today}" required></label>
          <label class="field"><span class="eyebrow">Amount</span><input type="number" name="amount" step="0.01" min="0" placeholder="0.00" required></label>
        </div>
        <label class="field"><span class="eyebrow">Type</span><select name="type"><option value="expense">Expense</option><option value="income">Income</option></select></label>
        <label class="field"><span class="eyebrow">Merchant</span><input name="merchant" placeholder="e.g. Whole Foods Market"></label>
        <label class="field"><span class="eyebrow">Category</span><select name="category"><option value="">Auto-categorize</option>${CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
        <label class="field"><span class="eyebrow">Note (optional)</span><input name="note"></label>
      </form>
      <div class="foot"><button class="btn ghost" id="mc">Cancel</button><button class="btn primary" id="ms">Add</button></div>
    </div></div>`;
    const close = () => (root.innerHTML = '');
    $('#mx').onclick = close; $('#mc').onclick = close;
    root.querySelector('.overlay').onclick = (e) => { if (e.target === root.querySelector('.overlay')) close(); };
    $('#ms').onclick = async () => {
      const body = Object.fromEntries(new FormData($('#af')).entries());
      if (!body.amount || Number(body.amount) <= 0) return toast('Enter an amount.', true);
      try { await api('/api/transactions', { method: 'POST', body }); toast('Added.'); close(); load(); }
      catch (e) { toast(e.message, true); }
    };
  }

  $('#add-btn').onclick = openAdd;
  initFilters().then(load).catch((e) => toast(e.message, true));
})();
