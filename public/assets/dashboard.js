(function () {
  const { api, money, signedMoney, esc, catColor, toast, svg } = window.LL;
  const $ = (s) => document.querySelector(s);

  const fmtMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const fmtDay = (iso) => Number(iso.slice(8, 10));

  let state = { month: null, mode: 'monthly', data: null };

  async function load(month) {
    const data = await api('/api/dashboard' + (month ? `?month=${month}` : ''));
    state.data = data;
    state.month = data.month;
    renderMonthSelect(data.months, data.month);
    renderKpis(data.kpis);
    renderTime();
    renderCat(data.categories);
    renderMerchants(data.merchants);
    renderRecent();
    $('#cat-month').textContent = fmtMonth(data.month);
  }

  function renderMonthSelect(months, sel) {
    const el = $('#month');
    el.innerHTML = months.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${fmtMonth(m)}</option>`).join('');
    el.onchange = () => load(el.value);
  }

  function delta(pct, invert) {
    if (pct == null) return '';
    const bad = invert ? pct < 0 : pct > 0;
    const arrow = pct >= 0 ? svg('up', 13) : svg('down', 13);
    return `<span class="d" style="color:${bad ? 'var(--amber)' : 'var(--mint)'}">${arrow}${Math.abs(pct)}% vs prev</span>`;
  }

  function renderKpis(k) {
    const cards = [
      ['Total spent', money(k.spend, true), delta(k.spendDeltaPct, false)],
      ['Income', money(k.income, true), `<span class="d">${k.txnCount} transactions</span>`],
      ['Net saved', `<span class="${k.net >= 0 ? 'pos' : 'neg'}">${signedMoney(k.net)}</span>`, `<span class="d">${k.savingsRate == null ? '' : k.savingsRate + '% savings rate'}</span>`],
      ['Avg / day', money(k.avgPerDay), `<span class="d">${fmtMonth(k.month)}</span>`],
      ['Top category', `<span style="font-size:17px">${esc(k.topCategory)}</span>`, `<span class="d">${k.uncategorized ? k.uncategorized + ' uncategorized' : 'all sorted'}</span>`],
    ];
    $('#kpis').innerHTML = cards
      .map(([l, v, d]) => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v mono">${v}</div>${d || ''}</div>`)
      .join('');
  }

  function bars(items, valueOf, labelOf, highlightLast) {
    const max = Math.max(1, ...items.map(valueOf));
    return `<div class="bars">${items
      .map((it, i) => {
        const on = highlightLast && i === items.length - 1;
        const h = Math.max(2, Math.round((valueOf(it) / max) * 100));
        return `<div class="bar-col ${on ? 'on' : ''}">
          <div class="bar-track"><div class="bar ${on ? 'on' : ''}" style="height:${h}%"></div></div>
          <span class="bar-lbl">${labelOf(it)}</span></div>`;
      })
      .join('')}</div>`;
  }

  function renderTime() {
    const d = state.data;
    if (state.mode === 'monthly') {
      $('#time-sub').textContent = 'Last 6 months';
      $('#chart-time').innerHTML = bars(d.monthly, (m) => m.spend, (m) => m.label.split(' ')[0], true);
    } else {
      $('#time-sub').textContent = `Daily · ${fmtMonth(d.month)}`;
      $('#chart-time').innerHTML = bars(d.daily, (x) => x.spend, (x) => (x.day % 5 === 1 ? x.day : ''), false);
    }
  }

  function renderCat(cats) {
    const top = cats.slice(0, 6);
    const otherAmt = cats.slice(6).reduce((s, c) => s + c.amount, 0);
    const total = cats.reduce((s, c) => s + c.amount, 0) || 1;
    const segs = top.map((c) => ({ name: c.category, amount: c.amount, pct: c.pct, spike: c.spike, color: catColor(c.category) }));
    if (otherAmt > 0) segs.push({ name: `Other (${cats.length - 6})`, amount: otherAmt, pct: Math.round((otherAmt / total) * 1000) / 10, color: 'var(--c-other)' });

    let acc = 0;
    const stops = segs
      .map((s) => { const a = acc; acc += (s.amount / total) * 100; return `${s.color} ${a.toFixed(2)}% ${acc.toFixed(2)}%`; })
      .join(',');

    const legend = segs
      .map((s) => `<div class="row" style="font-size:12.5px;">
        <span class="dot" style="background:${s.color}"></span>
        <span class="name">${esc(s.name)}</span>
        <span class="mono" style="color:${s.spike ? 'var(--amber)' : 'var(--text-2)'}">${s.pct}%${s.spike ? ' ▲' : ''}</span>
      </div>`)
      .join('');

    const spikes = cats.filter((c) => c.spike);
    const overAvg = (c) => (c.avg3 ? Math.round(((c.amount - c.avg3) / c.avg3) * 100) : null);
    const note = spikes.length
      ? `<div style="border-top:1px solid var(--line);padding-top:12px;margin-top:14px;font-size:12px;color:var(--text-2);display:flex;gap:8px;">
           <span style="color:var(--amber);flex-shrink:0;">${svg('warn', 15)}</span>
           <span>${spikes.map((c) => { const o = overAvg(c); return `${esc(c.category)} <span class="neg">${o != null ? '+' + o + '%' : 'high'}</span>`; }).join(', ')} vs your 3-month average.</span>
         </div>`
      : '';

    $('#chart-cat').innerHTML = `
      <div class="row" style="gap:16px;align-items:flex-start;">
        <div class="donut" style="background:conic-gradient(${stops})">
          <div class="hole"><span class="mono" style="font-size:14px;font-weight:600;">${money(total)}</span><small style="color:var(--text-3);font-size:10px;">spent</small></div>
        </div>
        <div class="legend">${legend}</div>
      </div>${note}`;
  }

  function renderMerchants(list) {
    if (!list.length) { $('#merchants').innerHTML = '<div class="empty">No spending yet this month.</div>'; return; }
    $('#merchants').innerHTML = list
      .map((m) => `<div class="spread" style="padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px;">
        <span>${esc(m.merchant)}</span>
        <span class="row" style="gap:12px;"><span class="muted mono" style="font-size:11px;">${m.count}×</span><span class="mono">${money(m.amount, true)}</span></span>
      </div>`)
      .join('');
  }

  async function renderRecent() {
    const { rows } = await api(`/api/transactions?month=${state.month}&limit=8`);
    if (!rows.length) { $('#recent').innerHTML = '<div class="empty">No transactions this month.</div>'; return; }
    $('#recent').innerHTML = rows
      .map((t) => `<div class="row" style="padding:7px 0;border-bottom:1px solid var(--hair);gap:10px;font-size:13px;">
        <span class="mono muted" style="font-size:11px;width:44px;flex-shrink:0;">${t.date.slice(8)} ${new Date(t.date + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.merchant || t.note || '—')}<span class="muted" style="font-size:11px;"> · ${esc(t.category)}</span></span>
        <span class="mono ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount, true)}</span>
      </div>`)
      .join('');
  }

  document.querySelectorAll('#time-mode button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#time-mode button').forEach((x) => x.classList.toggle('on', x === b));
      state.mode = b.dataset.m;
      renderTime();
    };
  });

  load().catch((e) => toast(e.message, true));
})();
