(function () {
  const { api, money, esc, catColor, toast, svg } = window.LL;
  const $ = (s) => document.querySelector(s);
  const fmtMonthLong = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
  const fmtMonthShort = (ym) => new Date(ym + '-01T00:00:00Z').toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  const state = { month: null, tab: 'cashflow', cf: null, dash: null };

  async function load(month) {
    const [cf, dash] = await Promise.all([
      api('/api/reports/cashflow' + (month ? `?month=${month}` : '')),
      api('/api/dashboard' + (month ? `?month=${month}` : '')),
    ]);
    state.cf = cf;
    state.dash = dash;
    state.month = cf.month;

    const sel = $('#month');
    if (!sel.options.length) {
      sel.innerHTML = cf.months.map((m) => `<option value="${m}" ${m === cf.month ? 'selected' : ''}>${fmtMonthShort(m)}</option>`).join('');
      sel.onchange = () => load(sel.value);
    }
    renderKpis();
    renderTab();
  }

  function renderKpis() {
    const d = state.cf;
    const cards = [
      ['Total income', `<span class="pos">${money(d.income, true)}</span>`],
      ['Total expenses', money(d.expenses, true)],
      ['Net income', `<span class="${d.net >= 0 ? 'pos' : 'neg'}">${d.net >= 0 ? '+' : '−'}${money(d.net, true)}</span>`],
      ['Savings rate', d.savingsRate == null ? '—' : d.savingsRate + '%'],
    ];
    $('#kpis').innerHTML = cards.map(([l, v]) => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v mono">${v}</div></div>`).join('');
  }

  /* ---- shared: a simple CSS bar chart over the last 6 months ---- */
  function monthBars(pick, highlight) {
    const rows = state.dash.monthly;
    const max = Math.max(1, ...rows.map(pick));
    return `<div class="bars">${rows
      .map((r) => {
        const on = highlight && r.month === state.month;
        const h = Math.max(2, Math.round((pick(r) / max) * 100));
        return `<div class="bar-col ${on ? 'on' : ''}">
          <div class="bar-track"><div class="bar ${on ? 'on' : ''}" style="height:${h}%"></div></div>
          <span class="bar-lbl">${r.label.split(' ')[0]}</span></div>`;
      })
      .join('')}</div>`;
  }

  /* ---- tab: Cash Flow (Sankey) ---- */
  function renderCashflow() {
    const d = state.cf;
    const topExp = [...d.flows].filter((f) => !f.savings).sort((a, b) => b.amount - a.amount)[0];
    const note = `<span style="color:var(--mint);display:flex;flex-shrink:0;">${svg('spark', 15)}</span>
      <span>You kept <span class="pos">${d.savingsRate == null ? '—' : d.savingsRate + '%'}</span> of income in ${fmtMonthLong(d.month)}.${topExp ? ` ${esc(topExp.category)} is your largest expense at ${money(topExp.amount)}.` : ''}</span>`;
    return `<div class="card" style="display:flex;flex-direction:column;">
      <div class="spread" style="margin-bottom:6px;"><div><div class="eyebrow">Cash flow</div><div class="sub">${fmtMonthLong(d.month)}</div></div></div>
      <div id="sankey"></div>
      <div style="border-top:1px solid var(--line);padding-top:12px;margin-top:6px;display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--text-2);">${note}</div>
    </div>`;
  }

  // On phones the Sankey would shrink to unreadable text, so show the same flows as a bar list.
  const narrow = window.matchMedia('(max-width: 760px)');

  function drawFlowList(el, flows, total, d) {
    const src = (d.sources && d.sources[0]) || { merchant: 'Income', amount: d.income };
    const rows = flows.map((f) => {
      const pct = Math.round((f.amount / total) * 1000) / 10;
      const color = f.savings ? 'var(--mint)' : catColor(f.category);
      return `<div class="flow-row">
        <div class="flow-head"><span class="dot" style="background:${color}"></span><span class="name">${esc(f.category)}${f.spike ? ' <span class="neg">▲</span>' : ''}</span><span class="mono amt">${money(f.amount, true)} · ${pct}%</span></div>
        <div class="flow-bar"><i style="width:${Math.max(1.5, pct)}%;background:${color}"></i></div>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="flow-src"><span>${esc(src.merchant)}</span><span class="mono">${money(d.income, true)} · 100%</span></div>${rows}`;
  }

  function drawSankey() {
    const d = state.cf;
    const W = 1160, top = 16, spanH = 560, gap = 8;
    const flows = d.flows.filter((f) => f.amount > 0);
    const el = $('#sankey');
    if (!el) return;
    if (!flows.length) { el.innerHTML = '<div class="empty">No cash flow to show for this month.</div>'; return; }
    const total = flows.reduce((s, f) => s + f.amount, 0);
    if (narrow.matches) { drawFlowList(el, flows, total, d); return; }
    const usable = spanH - gap * (flows.length - 1);
    const Ax = 40, Bx = 470, Cx = 800, Aw = 12;
    let y = top;
    const nodes = flows.map((f) => {
      const h = Math.max(3, (f.amount / total) * usable);
      const n = { ...f, y0: y, y1: y + h, mid: y + h / 2, color: f.savings ? 'var(--mint)' : catColor(f.category) };
      y += h + gap;
      return n;
    });
    const bottom = y - gap;
    const ribbons = nodes.map((n) => `<path d="M482,${n.y0.toFixed(1)} C641,${n.y0.toFixed(1)} 641,${n.y0.toFixed(1)} 800,${n.y0.toFixed(1)} L800,${n.y1.toFixed(1)} C641,${n.y1.toFixed(1)} 641,${n.y1.toFixed(1)} 482,${n.y1.toFixed(1)} Z" fill="${n.color}" fill-opacity="0.30"></path>`).join('');
    const nodeRects = nodes.map((n) => `<rect x="${Cx}" y="${n.y0.toFixed(1)}" width="12" height="${(n.y1 - n.y0).toFixed(1)}" rx="2" fill="${n.color}"></rect>`).join('');
    const labels = nodes.map((n) => {
      const pct = Math.round((n.amount / total) * 1000) / 10;
      return `<text x="824" y="${(n.mid + 4).toFixed(1)}" font-size="13"><tspan fill="var(--text)" font-weight="${n.savings || pct > 20 ? 600 : 500}">${esc(n.category)}</tspan><tspan fill="var(--text-3)" font-family="'JetBrains Mono',monospace">   ${money(n.amount, true)} · ${pct}%${n.spike ? '  ▲' : ''}</tspan></text>`;
    }).join('');
    const src = (d.sources && d.sources[0]) || { merchant: 'Income', amount: d.income };
    el.innerHTML = `<svg viewBox="0 0 ${W} 620" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;font-family:'Space Grotesk',system-ui,sans-serif;">
      <path d="M52,${top} L470,${top} L470,${bottom.toFixed(1)} L52,${bottom.toFixed(1)} Z" fill="var(--c-income)" fill-opacity="0.16"></path>
      ${ribbons}
      <rect x="${Ax}" y="${top}" width="${Aw}" height="${(bottom - top).toFixed(1)}" rx="2" fill="var(--c-income)" fill-opacity="0.85"></rect>
      <rect x="${Bx}" y="${top}" width="${Aw}" height="${(bottom - top).toFixed(1)}" rx="2" fill="var(--c-income)" fill-opacity="0.85"></rect>
      ${nodeRects}${labels}
      <text x="34" y="${(bottom + 20).toFixed(1)}" font-size="12" fill="var(--text-2)">${esc(src.merchant)}</text>
      <text x="34" y="${(bottom + 35).toFixed(1)}" font-size="11" fill="var(--text-3)" font-family="'JetBrains Mono',monospace">${money(d.income, true)} · 100%</text>
      <text x="476" y="${(bottom + 20).toFixed(1)}" font-size="12" fill="var(--text-2)" text-anchor="middle">Income</text>
    </svg>`;
  }

  /* ---- tab: Spending ---- */
  function renderSpending() {
    const cats = state.dash.categories;
    const total = cats.reduce((s, c) => s + c.amount, 0) || 1;
    const rows = cats.map((c) => {
      const over = c.avg3 ? Math.round(((c.amount - c.avg3) / c.avg3) * 100) : null;
      return `<tr>
        <td><span class="dot" style="background:${catColor(c.category)};width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:8px;"></span>${esc(c.category)}</td>
        <td class="num mono">${money(c.amount, true)}</td>
        <td class="num mono muted">${Math.round((c.amount / total) * 100)}%</td>
        <td class="num mono" style="color:${c.spike ? 'var(--amber)' : 'var(--text-3)'}">${over == null ? '—' : (over > 0 ? '+' : '') + over + '%'}${c.spike ? ' ▲' : ''}</td>
        <td class="num mono muted">${money(c.avg3 || 0)}</td>
      </tr>`;
    }).join('');
    const merch = state.dash.merchants.map((m) => `<div class="spread" style="padding:8px 0;border-bottom:1px solid var(--hair);font-size:13px;">
      <span>${esc(m.merchant)}</span><span class="row" style="gap:12px;"><span class="muted mono" style="font-size:11px;">${m.count}×</span><span class="mono">${money(m.amount, true)}</span></span></div>`).join('');
    return `
      <div class="card"><div class="spread" style="margin-bottom:6px;"><h3>Spending over time</h3><span class="sub">Last 6 months</span></div>${monthBars((r) => r.spend, true)}</div>
      <div class="grid cols-a">
        <div class="card">
          <div class="spread" style="margin-bottom:12px;"><h3>By category</h3><span class="sub">${fmtMonthLong(state.month)}</span></div>
          <div class="scroll-x"><table class="tbl">
            <thead><tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th><th class="num">vs 3-mo avg</th><th class="num">3-mo avg</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty">No spending this month.</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card"><h3 style="margin-bottom:12px;">Top merchants</h3>${merch || '<div class="empty">None.</div>'}</div>
      </div>`;
  }

  /* ---- tab: Income ---- */
  function renderIncome() {
    const d = state.cf;
    const totalIncome = d.income || 1;
    const srcRows = (d.sources || []).map((s) => `<tr>
      <td>${esc(s.merchant || 'Deposit')}</td>
      <td class="num mono">${money(s.amount, true)}</td>
      <td class="num mono muted">${Math.round((s.amount / totalIncome) * 100)}%</td>
    </tr>`).join('');
    const monthsTbl = state.dash.monthly.map((r) => `<tr>
      <td>${esc(r.label)}</td>
      <td class="num mono pos">${money(r.income, true)}</td>
      <td class="num mono">${money(r.spend, true)}</td>
      <td class="num mono ${r.net >= 0 ? 'pos' : 'neg'}">${r.net >= 0 ? '+' : '−'}${money(r.net, true)}</td>
    </tr>`).join('');
    return `
      <div class="card"><div class="spread" style="margin-bottom:6px;"><h3>Income over time</h3><span class="sub">Last 6 months</span></div>${monthBars((r) => r.income, true)}</div>
      <div class="grid cols-b">
        <div class="card">
          <div class="spread" style="margin-bottom:12px;"><h3>Sources</h3><span class="sub">${fmtMonthLong(state.month)}</span></div>
          <div class="scroll-x"><table class="tbl">
            <thead><tr><th>Source</th><th class="num">Amount</th><th class="num">Share</th></tr></thead>
            <tbody>${srcRows || '<tr><td colspan="3" class="empty">No income recorded this month.</td></tr>'}</tbody>
          </table></div>
          <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px;font-size:12.5px;color:var(--text-2);">
            Kept <span class="pos">${d.savingsRate == null ? '—' : d.savingsRate + '%'}</span> of income · net <span class="${d.net >= 0 ? 'pos' : 'neg'}">${d.net >= 0 ? '+' : '−'}${money(d.net, true)}</span>.
          </div>
        </div>
        <div class="card"><h3 style="margin-bottom:12px;">Month by month</h3>
          <div class="scroll-x"><table class="tbl">
            <thead><tr><th>Month</th><th class="num">Income</th><th class="num">Spent</th><th class="num">Net</th></tr></thead>
            <tbody>${monthsTbl}</tbody>
          </table></div>
        </div>
      </div>`;
  }

  function renderTab() {
    document.querySelectorAll('.rtab').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    const body = $('#report-body');
    if (state.tab === 'spending') body.innerHTML = renderSpending();
    else if (state.tab === 'income') body.innerHTML = renderIncome();
    else { body.innerHTML = renderCashflow(); drawSankey(); }
  }

  document.querySelectorAll('.rtab').forEach((b) => {
    b.onclick = () => { state.tab = b.dataset.tab; renderTab(); };
  });
  narrow.addEventListener('change', () => { if (state.tab === 'cashflow' && state.cf) drawSankey(); });

  load().catch((e) => toast(e.message, true));
})();
