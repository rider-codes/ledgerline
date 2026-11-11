#!/usr/bin/env node
'use strict';

// Tunes the semantic weight and cosine cut-off of the app's retrieval (mode 'auto') on the TUNING split only.
// Held-out questions are never loaded here.
//
//   node --experimental-sqlite eval/tune.js
//
// Selection rule, fixed before the first run:
//   score(question) = F1 of Recall@20 and Precision@20          for questions with gold rows
//                   = 1 if nothing is returned, else 0           for unanswerable questions (group G)
//   objective       = mean score over the tuning questions
//   ties            -> higher mean Recall@20, then the setting closest to the current defaults (0.5, 0.5)
// Recall alone would always favour the lowest cut-off, so the objective also charges for unrelated rows
// and for answering questions that have no answer.

const fs = require('node:fs');
const path = require('node:path');
const { requireSnapshotDb } = require('./lib/guard');

process.env.DB_PATH = process.env.DB_PATH || path.resolve(__dirname, 'snapshots', 'eval.db');
const SNAP = requireSnapshotDb();
Object.assign(process.env, { CURRENCY: '₹', AI_BACKEND: 'rules', EMBED_ENABLED: 'true', EMBED_MODEL: 'nomic-embed-text', OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434' });

const { contentHash } = require('./lib/snapshot');
const { retrievalMetrics, floor4 } = require('./lib/score');

const WEIGHTS = [0, 0.25, 0.5, 0.75, 1];
const CUTOFFS = [0.4, 0.45, 0.5, 0.55, 0.6];
const DEFAULT = { weight: 0.5, semMin: 0.5 };

(async () => {
  const doc = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'questions.json'), 'utf8'));
  const hash = contentHash(SNAP);
  if (doc.meta.snapshotSha256 !== hash.sha256) throw new Error('snapshot content hash does not match the pinned one');
  const questions = doc.questions.filter((q) => q.split === 'tune'); // the held-out split stops here
  const K = doc.meta.k;

  const { db } = require('../src/db');
  const A = require('../src/analytics');
  const { retrieve } = require('../src/retrieve');
  const userId = {};
  for (const [name, d] of Object.entries(doc.meta.datasets)) {
    userId[name] = db.prepare('SELECT id FROM users WHERE email = ?').get(d.userEmail).id;
    A.pinDefaultMonth(userId[name], d.defaultMonth);
  }

  const grid = [];
  for (const weight of WEIGHTS) {
    for (const semMin of CUTOFFS) {
      let scoreSum = 0; let recallSum = 0; let precSum = 0; let gold = 0; let abstainOk = 0; let abstainN = 0;
      for (const q of questions) {
        const res = await retrieve(userId[q.dataset], q.question, { mode: 'auto', weight, semMin, k: K, evalMode: true, defaultMonth: doc.meta.datasets[q.dataset].defaultMonth });
        const ids = res.rows.map((r) => r.id);
        if (q.group === 'G') { abstainN++; if (!ids.length) { abstainOk++; scoreSum += 1; } continue; }
        const m = retrievalMetrics(ids, q.retrieval.goldIds, K);
        gold++; recallSum += m.recall; precSum += m.precision;
        scoreSum += m.recall + m.precision > 0 ? (2 * m.recall * m.precision) / (m.recall + m.precision) : 0;
      }
      grid.push({ weight, semMin, objective: scoreSum / questions.length, recallAt20: recallSum / gold, precisionAt20: precSum / gold, abstainOk, abstainN });
    }
  }
  if (contentHash(SNAP).sha256 !== hash.sha256) throw new Error('snapshot changed during tuning');

  const dist = (g) => Math.abs(g.weight - DEFAULT.weight) + Math.abs(g.semMin - DEFAULT.semMin);
  const EPS = 1e-12;
  const best = [...grid].sort((a, b) => (Math.abs(b.objective - a.objective) > EPS ? b.objective - a.objective : Math.abs(b.recallAt20 - a.recallAt20) > EPS ? b.recallAt20 - a.recallAt20 : dist(a) - dist(b)))[0];
  const current = grid.find((g) => g.weight === DEFAULT.weight && g.semMin === DEFAULT.semMin);

  const f = (x) => floor4(x).toFixed(4);
  const md = [];
  md.push('# Blend tuning (tuning split only)', '');
  md.push(`- ${questions.length} tuning questions; held-out questions were not loaded`);
  md.push(`- retrieval mode: auto (the app's behaviour); k = ${K}; snapshot sha256 \`${hash.sha256}\``);
  md.push('- objective = mean per-question score: F1 of Recall@20 and P@20 for questions with gold rows; 1 or 0 for unanswerable questions (nothing returned or not)', '');
  md.push('| weight | cut-off | objective | Recall@20 | P@20 | abstain ok |', '|---|---|---|---|---|---|');
  for (const g of grid) md.push(`| ${g.weight} | ${g.semMin} | ${f(g.objective)} | ${f(g.recallAt20)} | ${f(g.precisionAt20)} | ${g.abstainOk}/${g.abstainN} |${g === best ? ' ← selected' : ''}${g === current ? ' (current default)' : ''}`);
  md.push('', `Selected: weight ${best.weight}, cut-off ${best.semMin} (objective ${f(best.objective)}; current default ${f(current.objective)}).`, '');

  const outDir = path.resolve(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tuning.json'), JSON.stringify({ ranAt: new Date().toISOString(), k: K, snapshot: hash.sha256, questions: questions.map((q) => q.id), weights: WEIGHTS, cutoffs: CUTOFFS, grid, selected: { weight: best.weight, semMin: best.semMin }, currentDefault: DEFAULT }, null, 1) + '\n');
  fs.writeFileSync(path.join(outDir, 'tuning.md'), md.join('\n'));
  console.log(md.join('\n'));
})().catch((e) => { console.error(`ABORTED: ${e.stack || e.message}`); process.exit(1); });
