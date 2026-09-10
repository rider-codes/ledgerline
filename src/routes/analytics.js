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

router.get('/dashboard', (req, res) => {
  const { month, months } = resolveMonth(req);
  res.json({
    month,
    months,
    kpis: A.kpis(req.user.id, month),
    monthly: A.monthlyTotals(req.user.id, 6, month),
    daily: A.dailySeries(req.user.id, month),
    categories: A.categoryBreakdown(req.user.id, month),
    merchants: A.topMerchants(req.user.id, month, 6),
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
