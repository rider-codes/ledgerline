'use strict';

const express = require('express');
const A = require('../analytics');
const { db } = require('../db');

const router = express.Router();

function resolveMonth(req) {
  const months = A.listMonths(req.user.id);
  let month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month) || !months.includes(month)) {
    month = A.defaultMonth(req.user.id);
  }
  return { month, months };
}

router.get('/months', (req, res) => {
  res.json({ months: A.listMonths(req.user.id), default: A.defaultMonth(req.user.id) });
});

// ?month= takes a month (YYYY-MM) or a whole year (YYYY). A year's response has the same
// shape: `monthly` is Jan..Dec of that year and `daily` is replaced by `yearly` (one bar per year).
router.get('/dashboard', (req, res) => {
  const uid = req.user.id;
  const years = A.listYears(uid);
  const q = String(req.query.month || '');
  if (A.isYear(q) && years.includes(q)) {
    return res.json({
      month: q,
      period: 'year',
      months: A.listMonths(uid),
      years,
      kpis: A.kpis(uid, q),
      monthly: A.yearMonths(uid, q),
      yearly: A.yearlyTotals(uid, 6),
      categories: A.categoryBreakdown(uid, q),
      merchants: A.topMerchants(uid, q, 6),
    });
  }
  const { month, months } = resolveMonth(req);
  res.json({
    month,
    period: 'month',
    months,
    years,
    kpis: A.kpis(uid, month),
    monthly: A.monthlyTotals(uid, 6, month),
    daily: A.dailySeries(uid, month),
    categories: A.categoryBreakdown(uid, month),
    merchants: A.topMerchants(uid, month, 6),
  });
});

router.get('/reports/cashflow', (req, res) => {
  const { month, months } = resolveMonth(req);
  const totals = A.monthTotals(req.user.id, month);
  const cats = A.categoryBreakdown(req.user.id, month);
  const savings = Math.max(0, totals.net);
  const denom = totals.income || totals.spend || 1;
  const flows = cats.map((c) => ({ category: c.category, amount: c.amount, pct: Math.round((c.amount / denom) * 1000) / 10, spike: c.spike }));
  if (savings > 0) flows.unshift({ category: 'Savings', amount: Math.round(savings * 100) / 100, pct: Math.round((savings / denom) * 1000) / 10, savings: true });
  const sources = db
    .prepare(
      `SELECT merchant, ROUND(SUM(amount),2) AS amount FROM transactions
       WHERE user_id = ? AND type='income' AND substr(date,1,7) = ? AND merchant <> ''
       GROUP BY merchant ORDER BY amount DESC`
    )
    .all(req.user.id, month);
  res.json({
    month,
    months,
    label: totals.label,
    income: totals.income,
    expenses: totals.spend,
    net: totals.net,
    savingsRate: totals.income ? Math.round((totals.net / totals.income) * 100) : null,
    sources: sources.length ? sources : [{ merchant: 'Income', amount: totals.income }],
    flows,
  });
});

module.exports = router;
