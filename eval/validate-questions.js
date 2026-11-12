#!/usr/bin/env node
'use strict';

// Validates an eval question file against eval/FORMAT.md.
//   node --experimental-sqlite eval/validate-questions.js <file> [--db <snapshot.db>] [--final]

const fs = require('node:fs');
const path = require('node:path');
const { assertSnapshotPath } = require('./lib/guard');

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--db');
const dbArg = args.includes('--db') ? args[args.indexOf('--db') + 1] : null;
const FINAL = args.includes('--final');
if (!file) { console.error('usage: validate-questions.js <file> [--db <snapshot.db>] [--final]'); process.exit(2); }

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const errors = [];
const warnings = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);

const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const meta = doc.meta || {};
const qs = Array.isArray(doc.questions) ? doc.questions : [];
if (meta.version !== 1) err('meta', 'version must be 1');
if (!Number.isInteger(meta.k) || meta.k < 1) err('meta', 'k must be a positive integer');
const datasets = meta.datasets || {};
if (!Object.keys(datasets).length) err('meta', 'datasets is empty');

const seen = new Set();
for (const q of qs) {
  const id = q.id || '(no id)';
  if (!/^[A-G]-\d{2}$/.test(String(q.id))) err(id, 'id must look like C-07');
  if (seen.has(q.id)) err(id, 'duplicate id');
  seen.add(q.id);
  if (!GROUPS.includes(q.group)) err(id, `group must be one of ${GROUPS.join('')}`);
  else if (String(q.id)[0] !== q.group) err(id, `id prefix does not match group ${q.group}`);
  if (!datasets[q.dataset]) err(id, `dataset "${q.dataset}" is not declared in meta.datasets`);
  if (!['tune', 'test'].includes(q.split)) err(id, 'split must be tune or test');
  if (typeof q.question !== 'string' || !q.question.trim()) err(id, 'question is empty');

  const r = q.retrieval;
  if (r !== null && typeof r !== 'object') err(id, 'retrieval must be an object or null');
  if (r) {
    if (!['sql', 'manual'].includes(r.goldBasis)) err(id, 'retrieval.goldBasis must be sql or manual');
    if (!['draft', 'confirmed'].includes(r.labelStatus)) err(id, 'retrieval.labelStatus must be draft or confirmed');
    if (!Array.isArray(r.goldIds) || !r.goldIds.every(Number.isInteger)) err(id, 'retrieval.goldIds must be an array of integers');
    if (r.goldBasis === 'sql' && typeof r.sql !== 'string') err(id, 'goldBasis "sql" needs a retrieval.sql string');
    if (['C', 'D'].includes(q.group) && r.goldBasis !== 'manual') err(id, 'groups C and D need goldBasis "manual"');
    if (r.labelStatus === 'confirmed' && q.group !== 'G' && !(r.goldIds || []).length) err(id, 'confirmed question has no goldIds');
    if (q.group === 'G' && (r.goldIds || []).length) err(id, 'group G must have goldIds: []');
    if (r.candidateIds && !r.candidateIds.every(Number.isInteger)) err(id, 'candidateIds must be integers');
  } else if (q.group === 'G') err(id, 'group G needs a retrieval object with goldIds: []');

  const a = q.answer;
  if (!a || !['number', 'count', 'abstain'].includes(a.type)) err(id, 'answer.type must be number, count or abstain');
  else if (a.type === 'abstain') {
    if (a.expected !== undefined) err(id, 'abstain answers have no expected');
  } else {
    const kinds = ['analytics', 'sql', 'goldSum', 'goldCount'].filter((k) => a.source && a.source[k] !== undefined);
    if (kinds.length !== 1) err(id, 'answer.source needs exactly one of analytics | sql | goldSum | goldCount');
    const needsGold = kinds[0] === 'goldSum' || kinds[0] === 'goldCount';
    if (needsGold && !r) err(id, `${kinds[0]} needs retrieval gold`);
    const confirmed = !r || r.labelStatus === 'confirmed';
    if (confirmed && !Number.isFinite(a.expected)) err(id, 'confirmed question needs a numeric answer.expected (generated from source)');
    if (a.tolerance !== undefined && !(a.tolerance >= 0)) err(id, 'answer.tolerance must be >= 0');
  }
  if (r && r.labelStatus === 'draft') warnings.push(`${id}: retrieval labels are draft — excluded from scoring`);
}

// ---- checks that need the snapshot database ----
if (dbArg) {
  const dbPath = assertSnapshotPath(dbArg);
  process.env.DB_PATH = dbPath; // so src/analytics.js reads the snapshot, never data/finance.db
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const A = require('../src/analytics');
  const userIds = {};
  for (const [name, d] of Object.entries(datasets)) {
    const u = db.prepare('SELECT id FROM users WHERE email = ?').get(d.userEmail);
    if (!u) err('meta', `dataset ${name}: no user ${d.userEmail} in ${path.basename(dbPath)}`);
    else userIds[name] = u.id;
  }
  const one = (sql, userId) => {
    const row = db.prepare(sql).all({ userId })[0];
    return row ? Object.values(row)[0] : null;
  };
  for (const q of qs) {
    const userId = userIds[q.dataset];
    if (userId == null) continue;
    try {
      checkAgainstDb(q, userId);
    } catch (e) {
      err(q.id, `could not check against the snapshot: ${e.message}`); // a bad query is an error, not a crash
    }
  }

  function checkAgainstDb(q, userId) {
    const r = q.retrieval;
    const goldIds = r ? r.goldIds || [] : [];
    if (goldIds.length) {
      const rows = db.prepare(`SELECT id, user_id FROM transactions WHERE id IN (${goldIds.map(() => '?').join(',')})`).all(...goldIds);
      const byId = new Map(rows.map((x) => [x.id, x.user_id]));
      for (const g of goldIds) {
        if (!byId.has(g)) err(q.id, `gold id ${g} does not exist in the snapshot`);
        else if (byId.get(g) !== userId) err(q.id, `gold id ${g} belongs to another user`);
      }
    }
    if (r && r.goldBasis === 'sql' && typeof r.sql === 'string') {
      const got = db.prepare(r.sql).all({ userId }).map((x) => x.id).sort((p, c) => p - c);
      const want = [...goldIds].sort((p, c) => p - c);
      if (JSON.stringify(got) !== JSON.stringify(want)) err(q.id, `retrieval.sql returns ${got.length} ids, goldIds has ${want.length} (they differ)`);
    }
    const a = q.answer;
    if (a && a.source && Number.isFinite(a.expected)) {
      let value = null;
      const s = a.source;
      if (s.sql) value = one(s.sql, userId);
      else if (s.analytics) value = new Function('A', 'db', 'userId', `return (${s.analytics});`)(A, db, userId);
      else if (s.goldSum || s.goldCount) {
        const rows = goldIds.length ? db.prepare(`SELECT amount FROM transactions WHERE id IN (${goldIds.map(() => '?').join(',')})`).all(...goldIds) : [];
        value = s.goldSum ? rows.reduce((t, x) => t + x.amount, 0) : rows.length;
      }
      const tol = a.tolerance ?? (a.type === 'count' ? 0 : 0.01);
      if (!Number.isFinite(value) || Math.abs(value - a.expected) > tol) err(q.id, `answer.expected ${a.expected} does not match its source (${value})`);
    }
  }
}


// ---- whole-file checks ----
if (FINAL) {
  if (qs.length !== 50) err('file', `expected 50 questions, found ${qs.length}`);
  const tune = qs.filter((q) => q.split === 'tune').length;
  const test = qs.filter((q) => q.split === 'test').length;
  if (tune !== 35 || test !== 15) err('file', `expected 35 tune / 15 test, found ${tune} / ${test}`);
  for (const q of qs) if (q.retrieval && q.retrieval.labelStatus !== 'confirmed') err(q.id, 'not confirmed');
  for (const [name, d] of Object.entries(datasets)) if (!d.defaultMonth) err('meta', `dataset ${name}: defaultMonth not pinned`);
}

const by = (key) => Object.entries(qs.reduce((m, q) => ((m[q[key]] = (m[q[key]] || 0) + 1), m), {})).map(([k, v]) => `${k}:${v}`).join(' ');
console.log(`${qs.length} questions | groups ${by('group')} | datasets ${by('dataset')} | splits ${by('split')}`);
warnings.forEach((w) => console.log(`warn  ${w}`));
if (errors.length) {
  errors.forEach((e) => console.log(`ERROR ${e}`));
  console.log(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log(`OK${dbArg ? ' (including snapshot checks)' : ' (structure only)'}`);
