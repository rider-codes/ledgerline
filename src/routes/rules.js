'use strict';

const express = require('express');
const { db, CATEGORIES } = require('../db');
const { loadModel, learn } = require('../categorize');

const router = express.Router();
const KNOWN = new Set(CATEGORIES);

router.get('/rules', (req, res) => {
  const rows = db.prepare('SELECT id, match_text, category, created_at FROM rules WHERE user_id = ? ORDER BY id').all(req.user.id);
  const withCounts = rows.map((r) => {
    const c = db
      .prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND instr(upper(merchant), upper(?)) > 0`)
      .get(req.user.id, r.match_text).c;
    return { ...r, matches: c };
  });
  res.json({ rows: withCounts, categories: CATEGORIES });
});

router.post('/rules', (req, res) => {
  const match_text = String((req.body && req.body.match_text) || '').trim();
  const category = String((req.body && req.body.category) || '').trim();
  if (match_text.length < 2) return res.status(400).json({ error: 'Match text must be at least 2 characters.' });
  if (!KNOWN.has(category)) return res.status(400).json({ error: 'Unknown category.' });

  const dup = db.prepare('SELECT id FROM rules WHERE user_id = ? AND upper(match_text) = upper(?)').get(req.user.id, match_text);
  let ruleId;
  if (dup) {
    db.prepare('UPDATE rules SET category = ? WHERE id = ?').run(category, dup.id);
    ruleId = dup.id;
  } else {
    ruleId = Number(db.prepare('INSERT INTO rules (user_id, match_text, category) VALUES (?, ?, ?)').run(req.user.id, match_text, category).lastInsertRowid);
  }

  let updated = 0;
  if (req.body && req.body.applyExisting) {
    updated = db
      .prepare(`UPDATE transactions SET category = ? WHERE user_id = ? AND type='expense' AND instr(upper(merchant), upper(?)) > 0`)
      .run(category, req.user.id, match_text).changes;
    learn(req.user.id, match_text, category);
  }
  const rule = db.prepare('SELECT id, match_text, category, created_at FROM rules WHERE id = ?').get(ruleId);
  res.json({ rule, updated });
});

router.delete('/rules/:id', (req, res) => {
  const info = db.prepare('DELETE FROM rules WHERE id = ? AND user_id = ?').run(parseInt(req.params.id, 10), req.user.id);
  res.json({ deleted: info.changes });
});

router.get('/model', (req, res) => {
  const m = loadModel(req.user.id);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?`).get(req.user.id).c;
  const sorted = db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND category <> 'Uncategorized'`).get(req.user.id).c;
  res.json({
    corrections: m.docs || 0,
    classes: Object.keys(m.classDocs || {}).length,
    vocab: Object.keys(m.vocab || {}).length,
    autoMatchRate: total ? Math.round((sorted / total) * 100) : null,
  });
});

module.exports = router;
