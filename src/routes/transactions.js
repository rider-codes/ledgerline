'use strict';

const express = require('express');
const multer = require('multer');
const { db, EXPENSE_CATEGORIES, CATEGORIES } = require('../db');
const A = require('../analytics');
const csv = require('../csv');
const { categorize, learn, predict, normalizeMerchant } = require('../categorize');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

const KNOWN = new Set(CATEGORIES);
const bad = (res, msg) => res.status(400).json({ error: msg });

// Parse a user-supplied money value. Returns a positive number rounded to cents,
// or null for anything non-finite, zero/negative, or absurdly large.
const MAX_AMOUNT = 1e12;
function parseAmount(v) {
  const n = Math.abs(parseFloat(v));
  if (!Number.isFinite(n) || n <= 0 || n >= MAX_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}

/* ---------- list ---------- */
router.get('/transactions', (req, res) => {
  const { month, category, type } = req.query;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
  const rows = A.recentTransactions(req.user.id, { month, category, type, limit, offset });
  const where = ['user_id = ?'];
  const args = [req.user.id];
  if (month) { where.push('substr(date,1,7) = ?'); args.push(month); }
  if (category) { where.push('category = ?'); args.push(category); }
  if (type) { where.push('type = ?'); args.push(type); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE ${where.join(' AND ')}`).get(...args).c;
  res.json({ rows, total, categories: EXPENSE_CATEGORIES });
});

/* ---------- create (manual) ---------- */
router.post('/transactions', (req, res) => {
  const b = req.body || {};
  const date = csv.parseDate(b.date);
  const amount = parseAmount(b.amount);
  const type = b.type === 'income' ? 'income' : 'expense';
  if (!date) return bad(res, 'A valid date is required.');
  if (amount == null) return bad(res, 'Enter a positive amount.');
  const merchant = normalizeMerchant(b.merchant || '');
  let category = b.category;
  if (type === 'income') category = 'Income';
  else if (!category || !KNOWN.has(category)) category = categorize(req.user.id, merchant || b.note || '', null).category;

  const info = db
    .prepare(
      `INSERT INTO transactions (user_id, date, amount, type, category, merchant, note, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')`
    )
    .run(req.user.id, date, amount, type, category, merchant, String(b.note || ''));
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(info.lastInsertRowid));
  res.json({ row });
});

/* ---------- update ---------- */
router.patch('/transactions/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!cur) return res.status(404).json({ error: 'Not found.' });

  const b = req.body || {};
  const next = {
    date: b.date != null ? (csv.parseDate(b.date) || cur.date) : cur.date,
    amount: b.amount != null ? (parseAmount(b.amount) ?? cur.amount) : cur.amount,
    type: b.type === 'income' || b.type === 'expense' ? b.type : cur.type,
    category: b.category != null && KNOWN.has(b.category) ? b.category : cur.category,
    merchant: b.merchant != null ? normalizeMerchant(b.merchant) : cur.merchant,
    note: b.note != null ? String(b.note) : cur.note,
  };

  db.prepare(
    `UPDATE transactions SET date=?, amount=?, type=?, category=?, merchant=?, note=? WHERE id=? AND user_id=?`
  ).run(next.date, next.amount, next.type, next.category, next.merchant, next.note, id, req.user.id);

  let ruleSuggestion = null;
  if (next.category !== cur.category && next.category !== 'Uncategorized') {
    // teach the classifier from this correction
    learn(req.user.id, `${next.merchant} ${next.note}`.trim(), next.category);
    if (next.merchant) {
      const token = next.merchant.split(/\s+/).slice(0, 2).join(' ').toUpperCase();
      const existing = db.prepare('SELECT id FROM rules WHERE user_id=? AND upper(match_text)=?').get(req.user.id, token);
      if (!existing) ruleSuggestion = { match_text: token, category: next.category };
    }
  }
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  res.json({ row, ruleSuggestion });
});

/* ---------- delete ---------- */
router.delete('/transactions/:id', (req, res) => {
  const info = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(parseInt(req.params.id, 10), req.user.id);
  res.json({ deleted: info.changes });
});

/* ---------- uncategorized queue (for the Rules screen) ---------- */
router.get('/uncategorized', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, date, amount, merchant, note FROM transactions
       WHERE user_id = ? AND category = 'Uncategorized' ORDER BY date DESC LIMIT 100`
    )
    .all(req.user.id);
  const withGuess = rows.map((r) => {
    const p = predict(req.user.id, `${r.merchant} ${r.note}`.trim());
    return { ...r, guess: p.category, confidence: p.confidence ? Math.round(p.confidence * 100) : null };
  });
  res.json({ rows: withGuess, total: withGuess.length });
});

/* ---------- CSV import: preview ---------- */
router.post('/import/preview', upload.single('file'), (req, res) => {
  const body = req.body || {};
  const text = req.file ? req.file.buffer.toString('utf8') : body.csv;
  if (!text || !text.trim()) return bad(res, 'No CSV content received.');
  let mapping = body.mapping;
  if (typeof mapping === 'string') { try { mapping = JSON.parse(mapping); } catch { mapping = null; } }
  try {
    res.json(csv.preview(text, mapping, { positiveMeans: body.positiveMeans }));
  } catch (e) {
    bad(res, `Could not parse CSV: ${e.message}`);
  }
});

/* ---------- CSV import: commit ---------- */
router.post('/import/commit', upload.single('file'), (req, res) => {
  const body = req.body || {};
  const text = req.file ? req.file.buffer.toString('utf8') : body.csv;
  if (!text || !text.trim()) return bad(res, 'No CSV content received.');

  let mapping = body.mapping;
  if (typeof mapping === 'string') { try { mapping = JSON.parse(mapping); } catch { mapping = null; } }
  if (!mapping || (!mapping.amount && !mapping.debit && !mapping.credit) || !mapping.date) {
    return bad(res, 'Mapping must include a date column and an amount (or debit/credit) column.');
  }
  const positiveMeans = body.positiveMeans === 'expense' ? 'expense' : 'income';

  const { rows, skipped } = csv.normalizeAll(text, mapping, { userId: req.user.id, positiveMeans });

  const MAX_IMPORT_ROWS = Math.max(1000, parseInt(process.env.IMPORT_MAX_ROWS || '20000', 10) || 20000);
  if (rows.length > MAX_IMPORT_ROWS) {
    return bad(res, `That file has ${rows.length} usable rows; the per-import limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`);
  }

  const existing = new Set(
    db.prepare('SELECT import_hash FROM transactions WHERE user_id = ? AND import_hash IS NOT NULL').all(req.user.id).map((r) => r.import_hash)
  );

  const insert = db.prepare(
    `INSERT INTO transactions (user_id, date, amount, type, category, merchant, note, source, import_hash)
     VALUES (?, ?, ?, ?, ?, ?, '', 'csv', ?)`
  );

  let inserted = 0;
  let duplicates = 0;
  let uncategorized = 0;
  const byCategory = {};
  const seen = new Set();

  const tx = db.prepare('BEGIN');
  tx.run();
  try {
    for (const r of rows) {
      if (existing.has(r.hash) || seen.has(r.hash)) { duplicates++; continue; }
      seen.add(r.hash);
      const merchant = normalizeMerchant(r.description);
      let category;
      if (r.type === 'income') category = 'Income';
      else category = categorize(req.user.id, r.description, r.csvCategory).category;
      if (category === 'Uncategorized') uncategorized++;
      insert.run(req.user.id, r.date, r.amount, r.type, category, merchant, r.hash);
      inserted++;
      byCategory[category] = (byCategory[category] || 0) + 1;
    }
    db.prepare('COMMIT').run();
  } catch (e) {
    try { db.prepare('ROLLBACK').run(); } catch { /* already rolled back */ }
    console.error('import error:', e);
    return res.status(500).json({ error: 'Import failed while writing rows. No changes were saved.' });
  }

  res.json({ inserted, duplicates, uncategorized, skipped, byCategory, totalRows: rows.length + skipped });
});

module.exports = router;
