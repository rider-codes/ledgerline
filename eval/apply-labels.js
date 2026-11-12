#!/usr/bin/env node
'use strict';

// Turns the ticks in eval/labeling-worksheet.md into gold ids in eval/questions.json.
//   node --experimental-sqlite eval/apply-labels.js [--dry-run]
//        [--questions f] [--pools f] [--worksheet f] [--out f]
//
// A ticked line labels EVERY expense row with that exact merchant text (within the question's scope).
// Sections with no ticks are left as drafts. `answer.expected` is recomputed from its source.

const fs = require('node:fs');
const path = require('node:path');
const { requireSnapshotDb } = require('./lib/guard');

process.env.DB_PATH = process.env.DB_PATH || path.resolve(__dirname, 'snapshots', 'eval.db');
requireSnapshotDb();

const { db } = require('../src/db');
const A = require('../src/analytics');
const { computeExpected } = require('./lib/gold');

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const files = {
  questions: opt('--questions', path.resolve(__dirname, 'questions.json')),
  pools: opt('--pools', path.resolve(__dirname, 'labeling-pools.json')),
  worksheet: opt('--worksheet', path.resolve(__dirname, 'labeling-worksheet.md')),
};
const outFile = opt('--out', files.questions);
const dry = args.includes('--dry-run');

const doc = JSON.parse(fs.readFileSync(files.questions, 'utf8'));
const pools = JSON.parse(fs.readFileSync(files.pools, 'utf8'));
const text = fs.readFileSync(files.worksheet, 'utf8');
const userIdOf = {};
for (const [name, d] of Object.entries(doc.meta.datasets)) userIdOf[name] = db.prepare('SELECT id FROM users WHERE email = ?').get(d.userEmail).id;

const sections = text.split(/^## /m).slice(1).map((s) => ({ id: s.slice(0, s.indexOf(' ')), body: s }));
const problems = [];
const report = [];

for (const sec of sections) {
  const q = doc.questions.find((x) => x.id === sec.id);
  const pool = pools[sec.id];
  if (!q || !pool) { problems.push(`${sec.id}: not found in questions.json / labeling-pools.json`); continue; }

  const ticked = [...sec.body.matchAll(/^- \[[xX]\] .*⟨(\d+)⟩\s*$/gm)].map((m) => Number(m[1]));
  const extraLine = (sec.body.match(/^Also include \([^)]*\):[ \t]*(.*)$/m) || [])[1] || '';
  const extras = extraLine.split(';').map((s) => s.trim()).filter(Boolean);
  const note = ((sec.body.match(/^Note:[ \t]*(.*)$/m) || [])[1] || '').trim();

  if (!ticked.length && !extras.length) {
    report.push(`${sec.id}  ${/^none$/i.test(note) ? 'MARKED "none" — question has no relevant rows, needs rework' : 'unlabelled (left as draft)'}`);
    if (/^none$/i.test(note)) problems.push(`${sec.id}: marked "none"`);
    continue;
  }

  const ids = new Set();
  const used = [];
  for (const i of ticked) {
    const g = pool.groups[i];
    if (!g) { problems.push(`${sec.id}: tick ⟨${i}⟩ does not exist`); continue; }
    g.ids.forEach((x) => ids.add(x));
    used.push(g.merchant);
  }
  const scopeKeys = Object.keys(pool.scopeIds);
  for (const e of extras) {
    // exact text first; fall back to a case-insensitive match only when it is unambiguous
    const loose = scopeKeys.filter((k) => k.toLowerCase() === e.toLowerCase());
    const key = scopeKeys.includes(e) ? e : loose.length === 1 ? loose[0] : null;
    if (!key && loose.length > 1) { problems.push(`${sec.id}: "Also include" merchant "${e}" matches several texts by case (${loose.join(' / ')}); use the exact one`); continue; }
    if (!key) { problems.push(`${sec.id}: "Also include" merchant "${e}" is not an expense merchant text in scope`); continue; }
    pool.scopeIds[key].forEach((x) => ids.add(x));
    used.push(key);
  }
  q.retrieval.goldIds = [...ids].sort((a, b) => a - b);
  q.retrieval.labelStatus = 'confirmed';
  q.retrieval.labelNotes = `Labelled by hand from labeling-worksheet.md: ${used.length} merchant text(s) ticked. ${note ? `Note: ${note}. ` : ''}Pool: ${pool.method}.`;
  q.answer.expected = computeExpected(q, { db, A, userId: userIdOf[q.dataset] });
  report.push(`${sec.id}  labelled: ${used.length} merchant text(s) → ${q.retrieval.goldIds.length} rows, expected ${q.answer.expected}`);
}

console.log(report.join('\n'));
const total = doc.questions.filter((q) => q.retrieval && q.retrieval.goldBasis === 'manual');
const done = total.filter((q) => q.retrieval.labelStatus === 'confirmed').length;
console.log(`\n${done}/${total.length} manual questions confirmed`);
if (problems.length) { console.log('\nPROBLEMS'); problems.forEach((p) => console.log(' - ' + p)); process.exit(1); }
if (dry) console.log('(dry run — nothing written)');
else { fs.writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n'); console.log(`wrote ${outFile}`); }
