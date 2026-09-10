'use strict';

const crypto = require('node:crypto');
const { CATEGORIES } = require('./db');

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

// Minimal RFC-4180-ish CSV parser: handles quotes, escaped quotes, CRLF,
// and newlines inside quoted fields.
function parseCSV(text) {
  const out = [];
  let row = [];
  let field = '';
  let inQ = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); out.push(row); }
  return out.filter((r) => r.length && !(r.length === 1 && r[0].trim() === ''));
}

function toObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { headers: rows[0] || [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const objs = rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows: objs };
}

/* ------------------------------------------------------------------ *
 * Column detection
 * ------------------------------------------------------------------ */

const CANDIDATES = {
  date: ['date', 'posting date', 'transaction date', 'trans date', 'post date', 'date posted', 'posted date'],
  amount: ['amount', 'amt', 'transaction amount'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'outflow'],
  credit: ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'inflow'],
  description: ['description', 'payee', 'name', 'merchant', 'memo', 'details', 'narrative', 'transaction', 'original description'],
  category: ['category', 'cat'],
  type: ['type', 'transaction type', 'debit/credit', 'dr/cr', 'credit debit indicator'],
};

function detectMapping(headers) {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const find = (names) => {
    for (const n of names) {
      const idx = lower.indexOf(n);
      if (idx !== -1) return headers[idx];
    }
    // loose contains match
    for (const n of names) {
      const idx = lower.findIndex((h) => h.includes(n));
      if (idx !== -1) return headers[idx];
    }
    return null;
  };
  const map = {};
  for (const key of Object.keys(CANDIDATES)) map[key] = find(CANDIDATES[key]);
  return map;
}

/* ------------------------------------------------------------------ *
 * Value normalization
 * ------------------------------------------------------------------ */

function parseAmount(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.trim().startsWith('-') || /-\s*$/.test(s)) neg = true;
  s = s.replace(/[^0-9.]/g, '');
  if (!s || s === '.') return NaN;
  const n = parseFloat(s);
  return Number.isNaN(n) ? NaN : (neg ? -n : n);
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/))) {
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    let mm = +a;
    let dd = +b;
    if (mm > 12 && dd <= 12) { const t = mm; mm = dd; dd = t; } // looks like D/M/Y
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

const KNOWN = new Map(CATEGORIES.map((c) => [c.toLowerCase(), c]));
function matchCategory(v) {
  if (!v) return null;
  return KNOWN.get(String(v).trim().toLowerCase()) || null;
}

function rowHash(userId, date, amount, description) {
  return crypto
    .createHash('sha1')
    .update(`${userId}|${date}|${Number(amount).toFixed(2)}|${String(description).trim().toLowerCase()}`)
    .digest('hex');
}

/* ------------------------------------------------------------------ *
 * Row -> transaction
 * ------------------------------------------------------------------ */

const EXPENSE_TYPE = /\bexpense\b|\bspend\b|debit|withdraw|purchase|payment|\bsale\b|\bdr\b|\bpos\b|outflow|\bpaid\s*out\b/i;
const INCOME_TYPE = /\bincome\b|credit|deposit|refund|payroll|salary|\bcr\b|interest|inflow|\bpaid\s*in\b/i;

// mapping: { date, amount|null, debit|null, credit|null, description, category, type }
// opts.positiveMeans: 'income' (default) | 'expense'  — only used for a single amount column
function normalizeRow(raw, mapping, opts = {}) {
  const date = parseDate(raw[mapping.date]);
  if (!date) return null;

  const description =
    (mapping.description && raw[mapping.description]) ||
    raw.Description || raw.Name || raw.Payee || raw.Memo || '';
  const typeHint = mapping.type ? String(raw[mapping.type] || '') : '';

  let amount = NaN;
  let type = null;

  if (mapping.debit || mapping.credit) {
    const dv = mapping.debit ? parseAmount(raw[mapping.debit]) : NaN;
    const cv = mapping.credit ? parseAmount(raw[mapping.credit]) : NaN;
    if (!Number.isNaN(dv) && Math.abs(dv) > 0) { amount = Math.abs(dv); type = 'expense'; }
    else if (!Number.isNaN(cv) && Math.abs(cv) > 0) { amount = Math.abs(cv); type = 'income'; }
  } else if (mapping.amount) {
    const v = parseAmount(raw[mapping.amount]);
    if (Number.isNaN(v) || v === 0) return null;
    if (typeHint && EXPENSE_TYPE.test(typeHint)) { type = 'expense'; amount = Math.abs(v); }
    else if (typeHint && INCOME_TYPE.test(typeHint)) { type = 'income'; amount = Math.abs(v); }
    else if (v < 0) { type = 'expense'; amount = -v; }
    else { type = (opts.positiveMeans === 'expense') ? 'expense' : 'income'; amount = v; }
  } else {
    return null;
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) return null;

  return {
    date,
    amount: Math.round(amount * 100) / 100,
    type,
    description: String(description).trim(),
    csvCategory: matchCategory(mapping.category ? raw[mapping.category] : null),
    hash: rowHash(opts.userId ?? 0, date, amount, description),
  };
}

/* ------------------------------------------------------------------ *
 * Public: preview + full normalize
 * ------------------------------------------------------------------ */

function preview(text, mappingOverride, opts = {}) {
  const { headers, rows } = toObjects(text);
  const mapping = mappingOverride && (mappingOverride.date || mappingOverride.amount || mappingOverride.debit || mappingOverride.credit)
    ? { ...detectMapping(headers), ...mappingOverride }
    : detectMapping(headers);
  const sample = rows.slice(0, 6).map((r) => ({
    raw: r,
    parsed: normalizeRow(r, mapping, { userId: 0, positiveMeans: opts.positiveMeans }),
  }));
  return { headers, mapping, totalRows: rows.length, sample };
}

function normalizeAll(text, mapping, opts = {}) {
  const { rows } = toObjects(text);
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const n = normalizeRow(r, mapping, opts);
    if (n) out.push(n);
    else skipped++;
  }
  return { rows: out, skipped };
}

module.exports = {
  parseCSV,
  toObjects,
  detectMapping,
  parseAmount,
  parseDate,
  matchCategory,
  rowHash,
  normalizeRow,
  preview,
  normalizeAll,
};
