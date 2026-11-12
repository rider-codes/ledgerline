'use strict';

const { db } = require('./db');

/* ---- month string helpers (YYYY-MM) ---- */
function addMonths(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* ---- periods: a month (YYYY-MM) or a whole year (YYYY) ----
   The aggregation functions below take either. Callers validate the string first
   (isPeriod); periodExpr only ever emits substr(date,1,4) or substr(date,1,7). */
const isYear = (p) => /^\d{4}$/.test(String(p));
const isPeriod = (p) => /^\d{4}(-\d{2})?$/.test(String(p));
const periodExpr = (p) => `substr(date,1,${isYear(p) ? 4 : 7})`;
function prevPeriod(p) { return isYear(p) ? String(Number(p) - 1) : addMonths(p, -1); }
function periodLabel(p) { return isYear(p) ? String(p) : monthLabel(p); }

/* ---- month / year discovery ---- */
function listMonths(userId) {
  return db
    .prepare(`SELECT DISTINCT substr(date,1,7) AS ym FROM transactions WHERE user_id = ? ORDER BY ym`)
    .all(userId)
    .map((r) => r.ym);
}
function listYears(userId) {
  return [...new Set(listMonths(userId).map((m) => m.slice(0, 4)))];
}

// Eval/test hook: pin a user's "current" month so results don't drift with the clock.
const pinnedMonth = new Map();
function pinDefaultMonth(userId, ym) {
  if (ym == null) pinnedMonth.delete(userId);
  else pinnedMonth.set(userId, ym);
}

function defaultMonth(userId) {
  if (pinnedMonth.has(userId)) return pinnedMonth.get(userId);
  const months = listMonths(userId);
  if (!months.length) return new Date().toISOString().slice(0, 7);
  const currentCal = new Date().toISOString().slice(0, 7);
  // Prefer complete months (exclude the in-progress calendar month when we have alternatives).
  let candidates = months.filter((m) => m !== currentCal);
  if (!candidates.length) candidates = months.slice();
  const count = (m) =>
    db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND substr(date,1,7) = ?`).get(userId, m).c;
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (count(candidates[i]) >= 10) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/* ---- core aggregations ---- */
function monthTotals(userId, ym) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS spend,
         COALESCE(SUM(CASE WHEN type='income'  THEN amount END),0) AS income
       FROM transactions WHERE user_id = ? AND ${periodExpr(ym)} = ?`
    )
    .get(userId, ym);
  const spend = round2(row.spend);
  const income = round2(row.income);
  return { month: ym, label: periodLabel(ym), spend, income, net: round2(income - spend) };
}

// Jan..Dec totals for one year (months without data are zeros).
function yearMonths(userId, year) {
  return Array.from({ length: 12 }, (_, i) => monthTotals(userId, `${year}-${String(i + 1).padStart(2, '0')}`));
}

// Totals for each year with data, oldest first (at most the last n).
function yearlyTotals(userId, n = 6) {
  return listYears(userId).slice(-n).map((y) => monthTotals(userId, y));
}

function monthlyTotals(userId, n = 6, endMonth) {
  const end = endMonth || defaultMonth(userId);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthTotals(userId, addMonths(end, -i)));
  return out;
}

function categorySpend(userId, ym) {
  const rows = db
    .prepare(
      `SELECT category, SUM(amount) AS amount, COUNT(*) AS count
       FROM transactions
       WHERE user_id = ? AND type='expense' AND ${periodExpr(ym)} = ?
       GROUP BY category`
    )
    .all(userId, ym);
  const map = {};
  for (const r of rows) map[r.category] = { amount: round2(r.amount), count: r.count };
  return map;
}

function categoryBreakdown(userId, ym) {
  // compared with the previous period and the average of the 3 before it (months or years)
  const cur = categorySpend(userId, ym);
  const prev = categorySpend(userId, prevPeriod(ym));
  const avg3 = {};
  for (let i = 1, p = ym; i <= 3; i++) {
    p = prevPeriod(p);
    const m = categorySpend(userId, p);
    for (const [cat, v] of Object.entries(m)) avg3[cat] = (avg3[cat] || 0) + v.amount / 3;
  }
  const total = Object.values(cur).reduce((s, v) => s + v.amount, 0) || 1;
  const out = Object.entries(cur).map(([category, v]) => {
    const prevAmt = prev[category]?.amount || 0;
    const base = avg3[category] || 0;
    return {
      category,
      amount: v.amount,
      count: v.count,
      pct: round2((v.amount / total) * 100),
      prevAmount: round2(prevAmt),
      deltaAbs: round2(v.amount - prevAmt),
      deltaPct: prevAmt ? Math.round(((v.amount - prevAmt) / prevAmt) * 100) : null,
      avg3: round2(base),
      spike: base > 0 && v.amount > base * 1.25 && v.amount - base > 40,
    };
  });
  out.sort((a, b) => b.amount - a.amount);
  return out;
}

function dailySeries(userId, ym) {
  const rows = db
    .prepare(
      `SELECT date, SUM(amount) AS spend
       FROM transactions
       WHERE user_id = ? AND type='expense' AND substr(date,1,7) = ?
       GROUP BY date`
    )
    .all(userId, ym);
  const map = Object.fromEntries(rows.map((r) => [r.date, round2(r.spend)]));
  const out = [];
  const n = daysInMonth(ym);
  for (let d = 1; d <= n; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    out.push({ date, day: d, spend: map[date] || 0 });
  }
  return out;
}

function topMerchants(userId, ym, limit = 6) {
  return db
    .prepare(
      `SELECT merchant,
              SUM(amount) AS amount,
              COUNT(*)    AS count,
              MAX(category) AS category
       FROM transactions
       WHERE user_id = ? AND type='expense' AND ${periodExpr(ym)} = ? AND merchant <> ''
       GROUP BY merchant
       ORDER BY amount DESC
       LIMIT ?`
    )
    .all(userId, ym, limit)
    .map((r) => ({ ...r, amount: round2(r.amount) }));
}

function kpis(userId, ym) {
  const year = isYear(ym);
  const cur = monthTotals(userId, ym);
  const prev = monthTotals(userId, prevPeriod(ym));
  const cats = categoryBreakdown(userId, ym);
  const topCategory = cats[0]?.category || '—';
  const uncategorized = db
    .prepare(
      `SELECT COUNT(*) AS c FROM transactions
       WHERE user_id = ? AND category = 'Uncategorized'`
    )
    .get(userId).c;
  const txnCount = db
    .prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND ${periodExpr(ym)} = ?`)
    .get(userId, ym).c;
  // a month averages per day; a year averages per month over the months that have data
  // (a year that starts in May shouldn't be divided by 12)
  let avgPerDay = null;
  let avgPerMonth = null;
  let monthsWithData = null;
  if (year) {
    monthsWithData = listMonths(userId).filter((m) => m.startsWith(`${ym}-`)).length;
    avgPerMonth = round2(cur.spend / Math.max(1, monthsWithData));
  } else {
    const dim = daysInMonth(ym);
    const now = new Date().toISOString().slice(0, 10);
    const elapsed = now.slice(0, 7) === ym ? Number(now.slice(8, 10)) : dim;
    avgPerDay = round2(cur.spend / Math.max(1, elapsed));
  }
  return {
    month: ym,
    period: year ? 'year' : 'month',
    label: cur.label,
    spend: cur.spend,
    income: cur.income,
    net: cur.net,
    savingsRate: cur.income ? Math.round((cur.net / cur.income) * 100) : null,
    prevSpend: prev.spend,
    spendDeltaPct: prev.spend ? Math.round(((cur.spend - prev.spend) / prev.spend) * 100) : null,
    avgPerDay,
    avgPerMonth,
    monthsWithData,
    txnCount,
    topCategory,
    uncategorized,
  };
}

function recentTransactions(userId, { month, category, type, limit = 50, offset = 0 } = {}) {
  const where = ['user_id = ?'];
  const args = [userId];
  if (month && isPeriod(month)) { where.push(`${periodExpr(month)} = ?`); args.push(month); }
  if (category) { where.push('category = ?'); args.push(category); }
  if (type) { where.push('type = ?'); args.push(type); }
  args.push(limit, offset);
  return db
    .prepare(
      `SELECT id, date, amount, type, category, merchant, note, source
       FROM transactions WHERE ${where.join(' AND ')}
       ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...args);
}

/* ---- markdown summary for the AI assistant ---- */
function buildSummary(userId, months = 6) {
  const end = defaultMonth(userId);
  const totals = monthlyTotals(userId, months, end);
  const cur = end;
  const prev = addMonths(end, -1);
  const curCats = categoryBreakdown(userId, cur);
  const merchants = topMerchants(userId, cur, 8);
  const subs = db
    .prepare(
      `SELECT merchant, COUNT(*) AS months, SUM(amount) AS total, AVG(amount) AS avg
       FROM transactions
       WHERE user_id = ? AND category='Subscriptions'
       GROUP BY merchant ORDER BY total DESC`
    )
    .all(userId);

  const lines = [];
  lines.push(`Currency: ${process.env.CURRENCY || '$'}. Latest month with data: ${monthLabel(cur)}.`);
  lines.push('');
  lines.push('MONTHLY TOTALS (spend / income / net):');
  for (const t of totals) lines.push(`- ${t.label}: ${t.spend} / ${t.income} / ${t.net}`);
  lines.push('');
  lines.push(`CATEGORY BREAKDOWN for ${monthLabel(cur)} (amount, % of month, vs prev month, vs 3-mo avg, spike?):`);
  for (const c of curCats) {
    lines.push(
      `- ${c.category}: ${c.amount} (${c.pct}%), prev ${c.prevAmount} (${c.deltaPct == null ? 'n/a' : c.deltaPct + '%'}), 3mo-avg ${c.avg3}${c.spike ? '  <-- SPIKE' : ''}`
    );
  }
  lines.push('');
  lines.push(`TOP MERCHANTS in ${monthLabel(cur)}:`);
  for (const m of merchants) lines.push(`- ${m.merchant} (${m.category}): ${m.amount} over ${m.count} charges`);
  if (subs.length) {
    lines.push('');
    lines.push('RECURRING SUBSCRIPTIONS seen:');
    for (const s of subs) lines.push(`- ${s.merchant}: ~${round2(s.avg)}/charge, ${s.months} charges, ${round2(s.total)} total`);
  }
  return { month: cur, prevMonth: prev, text: lines.join('\n') };
}

module.exports = {
  addMonths,
  monthLabel,
  isYear,
  isPeriod,
  periodExpr,
  periodLabel,
  listMonths,
  listYears,
  yearMonths,
  yearlyTotals,
  defaultMonth,
  pinDefaultMonth,
  monthlyTotals,
  monthTotals,
  categoryBreakdown,
  dailySeries,
  topMerchants,
  kpis,
  recentTransactions,
  buildSummary,
};
