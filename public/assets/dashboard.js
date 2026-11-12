(function () {
  const { api, money, signedMoney, esc, catColor, toast, svg } = window.LL;
  const $ = (s) => document.querySelector(s);

  const fmtMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  const fmtDay = (iso) => Number(iso.slice(8, 10));
  const isYear = (p) => /^\d{4}$/.test(p);
  const fmtPeriod = (p) => (isYear(p) ? p : fmtMonth(p));
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // period is a month (YYYY-MM) or a whole year (YYYY); mode picks the time chart
  let state = { month: null, year: false, mode: 'monthly', data: null };

  async function load(period) {
    const data = await api('/api/dashboard' + (period ? `?month=${encodeURIComponent(period)}` : ''));
    const year = data.period === 'year';
    if (year !== state.year) state.mode = 'monthly'; // the second toggle means Daily for a month, Yearly for a year
    state.data = data;
    state.month = data.month;
    state.year = year;
    renderPeriodSelect(data.years || [], data.months, data.month);
    renderTimeToggle();
    renderKpis(data.kpis);
    renderTime();
    renderCat(data.categories);
    renderMerchants(data.merchants);
    renderRecent();
    $('#cat-month').textContent = fmtPeriod(data.month);
  }

  function renderPeriodSelect(years, months, sel) {
    const el = $('#month');
    const opt = (v, label) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${label}</option>`;
    el.innerHTML =
      `<optgroup label="Full year">${years.slice().reverse().map((y) => opt(y, `${y} · full year`)).join('')}</optgroup>` +
      `<optgroup label="Month">${months.slice().reverse().map((m) => opt(m, fmtMonth(m))).join('')}</optgroup>`;
    el.onchange = () => load(el.value);
  }

  function renderTimeToggle() {
    const [first, second] = document.querySelectorAll('#time-mode button');
    second.textContent = state.year ? 'Yearly' : 'Daily';
    second.dataset.m = state.year ? 'yearly' : 'daily';
    first.classList.toggle('on', state.mode === 'monthly');
    second.classList.toggle('on', state.mode !== 'monthly');
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
      k.period === 'year'
        ? ['Avg / month', money(k.avgPerMonth), `<span class="d">over ${k.monthsWithData} month${k.monthsWithData === 1 ? '' : 's'} with data</span>`]
        : ['Avg / day', money(k.avgPerDay), `<span class="d">${fmtMonth(k.month)}</span>`],
      ['Top category', `<span style="font-size:17px">${esc(k.topCategory)}</span>`, `<span class="d">${k.uncategorized ? k.uncategorized + ' uncategorized' : 'all sorted'}</span>`],
    ];
    $('#kpis').innerHTML = cards
      .map(([l, v, d]) => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v mono">${v}</div>${d || ''}</div>`)
      .join('');
  }

  // compact amount for bar labels: 950, 4.3k, 1.2M
  const short = (v) => {
    const cur = (window.LL && window.LL.CUR) || '';
    if (v >= 1e6) return `${cur}${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1e3) return `${cur}${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return `${cur}${Math.round(v)}`;
  };

  // opts: highlight (index of the bar to light up, or -1), values (amount above each bar),
  //       avg: false | 'nonzero' (average over bars with spending, e.g. months with data)
  //            | 'all' (every bar counts, e.g. days — matches the Avg / day card), avgLabel
  function bars(items, valueOf, labelOf, opts = {}) {
    const { highlight = -1, values = false, avg = false, avgLabel = 'avg' } = opts;
    const vals = items.map(valueOf);
    const max = Math.max(1, ...vals);
    const pool = avg === 'all' ? vals : vals.filter((v) => v > 0);
    const mean = avg && pool.length > 1 && pool.some((v) => v > 0) ? pool.reduce((s, v) => s + v, 0) / pool.length : null;
    // 186px track, 16px label row, 8px gap between them (see .bar-track / .bar-lbl / .bar-col)
    const mark = mean == null ? ''
      : `<i class="avg-mark" style="bottom:calc(24px + ${((mean / max) * 186).toFixed(1)}px)"><span class="avg-tag">${avgLabel} ${short(mean)}</span></i>`;
    return `<div class="bars ${items.length > 14 ? 'dense' : ''}">${mark}${items
      .map((it, i) => {
        const v = vals[i];
        const on = i === highlight;
        const zero = v <= 0;
        const h = zero ? 1 : Math.max(2, Math.round((v / max) * 100));
        return `<div class="bar-col ${on ? 'on' : ''}" title="${esc(String(labelOf(it, true)))}: ${money(v, true)}">
          <div class="bar-track"><div class="bar ${on ? 'on' : ''} ${zero ? 'zero' : ''}" style="height:${h}%">${values && !zero ? `<span class="bar-val">${short(v)}</span>` : ''}</div></div>
          <span class="bar-lbl">${labelOf(it)}</span></div>`;
      })
      .join('')}</div>`;
  }

  function renderTime() {
    const d = state.data;
    const monthName = (m, full) => (full ? m.label : MONTH_ABBR[Number(m.month.slice(5)) - 1]);
    if (state.year && state.mode === 'monthly') {
      // light up the latest month of the year that has spending
      let last = -1;
      d.monthly.forEach((m, i) => { if (m.spend > 0) last = i; });
      $('#time-sub').textContent = `By month · ${d.month}`;
      $('#chart-time').innerHTML = bars(d.monthly, (m) => m.spend, monthName, { highlight: last, values: true, avg: 'nonzero', avgLabel: 'avg/mo' });
    } else if (state.year) {
      $('#time-sub').textContent = d.yearly.length > 1 ? `Last ${d.yearly.length} years` : 'Only one year of data so far';
      $('#chart-time').innerHTML = bars(d.yearly, (y) => y.spend, (y) => y.month, {
        highlight: d.yearly.findIndex((y) => y.month === d.month), values: true, avg: 'nonzero', avgLabel: 'avg/yr',
      });
    } else if (state.mode === 'monthly') {
      $('#time-sub').textContent = 'Last 6 months';
      $('#chart-time').innerHTML = bars(d.monthly, (m) => m.spend, (m, full) => (full ? m.label : m.label.split(' ')[0]), {
        highlight: d.monthly.length - 1, values: true, avg: 'nonzero', avgLabel: 'avg/mo',
      });
    } else {
      $('#time-sub').textContent = `Daily · ${fmtMonth(d.month)}`;
      $('#chart-time').innerHTML = bars(d.daily, (x) => x.spend, (x, full) => (full ? x.date : x.day % 5 === 1 ? x.day : ''), {
        avg: 'all', avgLabel: 'avg/day',
      });
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
           <span>${spikes.map((c) => { const o = overAvg(c); return `${esc(c.category)} <span class="neg">${o != null ? '+' + o + '%' : 'high'}</span>`; }).join(', ')} vs your 3-${state.year ? 'year' : 'month'} average.</span>
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
    if (!list.length) { $('#merchants').innerHTML = `<div class="empty">No spending yet this ${state.year ? 'year' : 'month'}.</div>`; return; }
    $('#merchants').innerHTML = list
      .map((m) => `<div class="spread" style="padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px;">
        <span>${esc(m.merchant)}</span>
        <span class="row" style="gap:12px;"><span class="muted mono" style="font-size:11px;">${m.count}×</span><span class="mono">${money(m.amount, true)}</span></span>
      </div>`)
      .join('');
  }

  async function renderRecent() {
    const { rows } = await api(`/api/transactions?month=${state.month}&limit=8`);
    if (!rows.length) { $('#recent').innerHTML = `<div class="empty">No transactions this ${state.year ? 'year' : 'month'}.</div>`; return; }
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
