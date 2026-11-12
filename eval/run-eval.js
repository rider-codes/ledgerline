#!/usr/bin/env node
'use strict';

// Runs the 50-question retrieval eval against the snapshot and writes eval/results/<label>.{json,md}.
//
//   node --experimental-sqlite eval/run-eval.js [--label baseline] [--pin] [--weight 1] [--semMin 0.6]
//
// Conditions (same k for all):
//   keyword   retrieve(mode 'lexical')                 SQL filters + BM25-lite
//   semantic  retrieve(mode 'semantic', semMin)        SQL filters + cosine only
//   blended   retrieve(mode 'hybrid', weight, semMin)  SQL filters + weighted mix
//   app       retrieve(mode 'auto', weight, semMin)    what the app does today
// Answers come from ask() with the deterministic rules backend. Everything runs in evalMode:
// no embedding writes, and any semantic / retrieval failure aborts the run.
// --pin writes the pinned default months and the snapshot content hash into the question file (first run only).

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { requireSnapshotDb } = require('./lib/guard');

process.env.DB_PATH = process.env.DB_PATH || path.resolve(__dirname, 'snapshots', 'eval.db');
const SNAP = requireSnapshotDb(); // refuses the live DB; must precede any require of ../src

// Fixed environment for every eval run. The app's .env is not read here.
const ENV = {
  CURRENCY: '₹', AI_BACKEND: 'rules', EMBED_ENABLED: 'true', EMBED_MODEL: 'nomic-embed-text',
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
};
Object.assign(process.env, ENV);

const { contentHash } = require('./lib/snapshot');
const { retrievalMetrics, judgeAnswer, floor4 } = require('./lib/score');

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const LABEL = opt('--label', 'baseline');
// Defaults are the tuned values the app ships with (eval/tune.js, src/embed.js). Runs before the
// `final-tuned` label used 0.5 / 0.5 and are comparable to each other, not to later runs.
const WEIGHT = Number(opt('--weight', '1'));
const SEM_MIN = Number(opt('--semMin', '0.6'));
const PIN = args.includes('--pin');
const QFILE = opt('--questions', path.resolve(__dirname, 'questions.json'));
const OUT_DIR = opt('--out', path.resolve(__dirname, 'results'));

const CONDITIONS = [
  { key: 'keyword', label: 'keyword', opts: { mode: 'lexical' } },
  { key: 'semantic', label: 'semantic', opts: { mode: 'semantic', semMin: SEM_MIN } },
  { key: 'blended', label: 'blended', opts: { mode: 'hybrid', weight: WEIGHT, semMin: SEM_MIN } },
  // no weight / semMin on purpose: this condition must use the app's own defaults (src/embed.js),
  // or the "app default" column stops measuring what ships
  { key: 'app', label: 'app default (auto)', opts: { mode: 'auto' } },
];

const fail = (msg) => { console.error(`ABORTED: ${msg}`); process.exit(1); };

(async () => {
  const doc = JSON.parse(fs.readFileSync(QFILE, 'utf8'));
  const { meta, questions } = doc;
  const K = meta.k;

  // ---- preconditions -------------------------------------------------------------------------
  const notConfirmed = questions.filter((q) => q.retrieval && q.retrieval.labelStatus !== 'confirmed').map((q) => q.id);
  if (notConfirmed.length) fail(`questions without confirmed gold: ${notConfirmed.join(' ')}`);
  if (questions.length !== 50) fail(`expected 50 questions, found ${questions.length}`);

  const hashBefore = contentHash(SNAP);
  if (meta.snapshotSha256 && meta.snapshotSha256 !== hashBefore.sha256) fail(`snapshot content hash ${hashBefore.sha256} differs from the one the gold ids were pinned to (${meta.snapshotSha256})`);
  if (!meta.snapshotSha256 && !PIN) fail('snapshot hash is not pinned yet; run once with --pin');

  const { db } = require('../src/db');
  const A = require('../src/analytics');
  const embed = require('../src/embed');
  const { retrieve } = require('../src/retrieve');
  const { ask } = require('../src/agent');

  const userId = {};
  const datasets = {};
  for (const [name, d] of Object.entries(meta.datasets)) {
    const u = db.prepare('SELECT id FROM users WHERE email = ?').get(d.userEmail);
    if (!u) fail(`user ${d.userEmail} is not in the snapshot`);
    userId[name] = u.id;
    // every transaction must have a current vector from the embedding model
    const rows = db.prepare(
      `SELECT t.id, t.date, t.amount, t.type, t.category, t.merchant, t.note, e.model, e.doc_hash
       FROM transactions t LEFT JOIN tx_embed e ON e.transaction_id = t.id WHERE t.user_id = ?`
    ).all(u.id);
    const current = rows.filter((r) => r.model === embed.model() && r.doc_hash === embed.docHash(r)).length;
    if (current !== rows.length) fail(`dataset ${name}: only ${current} of ${rows.length} transactions have a current ${embed.model()} vector`);
    const clockMonth = A.defaultMonth(u.id);
    if (!d.defaultMonth) {
      if (!PIN) fail(`dataset ${name}: defaultMonth is not pinned yet; run once with --pin`);
      d.defaultMonth = clockMonth;
    }
    A.pinDefaultMonth(u.id, d.defaultMonth);
    datasets[name] = { userId: u.id, transactions: rows.length, embedded: current, defaultMonth: d.defaultMonth, clockDerivedDefaultMonth: clockMonth };
  }

  let ollama;
  try {
    const base = ENV.OLLAMA_URL.replace(/\/$/, '');
    const version = (await (await fetch(`${base}/api/version`)).json()).version;
    const tags = (await (await fetch(`${base}/api/tags`)).json()).models || [];
    const find = (n) => tags.find((m) => m.name === n || m.name === `${n}:latest` || m.name.split(':')[0] === n);
    const em = find(ENV.EMBED_MODEL);
    if (!em) fail(`Ollama has no model ${ENV.EMBED_MODEL}`);
    const chat = find('llama3.2:3b');
    ollama = { version, embedModel: { name: em.name, digest: em.digest }, chatModel: chat ? { name: chat.name, digest: chat.digest, usedInThisRun: false } : null };
  } catch (e) {
    fail(`Ollama is not reachable (${e.message})`);
  }

  if (PIN && !meta.snapshotSha256) meta.snapshotSha256 = hashBefore.sha256;
  if (PIN) fs.writeFileSync(QFILE, JSON.stringify(doc, null, 2) + '\n');

  // ---- run -----------------------------------------------------------------------------------
  const records = [];
  for (const q of questions) {
    const uid = userId[q.dataset];
    const dm = meta.datasets[q.dataset].defaultMonth;
    const goldIds = q.retrieval.goldIds;
    const rec = { id: q.id, group: q.group, dataset: q.dataset, split: q.split, knownGap: !!q.knownGap, question: q.question, goldCount: goldIds.length, expected: q.answer.expected ?? null, answerType: q.answer.type, conditions: {} };

    // diagnostic, independent of any filter: cosine between the question and each gold row
    if (goldIds.length) {
      const goldRows = db.prepare(`SELECT id, date, amount, type, category, merchant, note FROM transactions WHERE id IN (${goldIds.map(() => '?').join(',')})`).all(...goldIds);
      const sem = await embed.semanticScores(goldRows, q.question, { readOnly: true, strict: true });
      const vals = goldRows.map((r) => sem.get(r.id));
      rec.goldCosine = { min: floor4(Math.min(...vals)), max: floor4(Math.max(...vals)), belowSemMin: vals.filter((v) => v < SEM_MIN).length };
    }

    for (const c of CONDITIONS) {
      const res = await retrieve(uid, q.question, { ...c.opts, k: K, evalMode: true, defaultMonth: dm });
      const rowIds = res.rows.map((r) => r.id);
      const cand = new Set(res.candidateIds);
      const retrieval = {
        ...retrievalMetrics(rowIds, goldIds, K),
        mode: res.mode, semanticUsed: res.semantic.used,
        filters: { ...res.filters, consumed: [...res.filters.consumed].sort() },
        matchCount: res.matchCount, candidateCount: res.candidateCount, qualifiedCount: res.qualifiedCount,
        goldInCandidates: goldIds.filter((id) => cand.has(id)).length,
        abstainOk: q.group === 'G' ? rowIds.length === 0 : null,
        rowIds,
      };
      const a = await ask(uid, q.question, [], { retrieval: { ...c.opts }, evalMode: true });
      if (a.mode !== 'rules') throw new Error(`${q.id}: answer came from backend "${a.mode}", expected rules`);
      const j = judgeAnswer(q.answer, a.reply, ENV.CURRENCY);
      rec.conditions[c.key] = { retrieval, answer: { correct: j.correct, got: j.got, route: a.trace.route, reply: a.reply } };
    }
    records.push(rec);
  }

  const hashAfter = contentHash(SNAP);
  if (hashAfter.sha256 !== hashBefore.sha256) fail('the snapshot content changed during the run');

  // ---- aggregate -----------------------------------------------------------------------------
  const aggregate = (recs, key) => {
    const R = recs.filter((r) => r.group !== 'G');
    const G = recs.filter((r) => r.group === 'G');
    const mean = (f) => (R.length ? R.reduce((t, r) => t + f(r.conditions[key].retrieval), 0) / R.length : null);
    return {
      nRetrieval: R.length,
      recallAt20: floor4(mean((x) => x.recall)),
      hits: R.filter((r) => r.conditions[key].retrieval.hit).length,
      hitRate: R.length ? floor4(R.filter((r) => r.conditions[key].retrieval.hit).length / R.length) : null,
      precisionAt20: floor4(mean((x) => x.precision)),
      mrr: floor4(mean((x) => x.mrr)),
      nAbstain: G.length,
      abstainOk: G.filter((r) => r.conditions[key].retrieval.abstainOk).length,
      nAnswer: recs.length,
      answerCorrect: recs.filter((r) => r.conditions[key].answer.correct).length,
      answerRate: recs.length ? floor4(recs.filter((r) => r.conditions[key].answer.correct).length / recs.length) : null,
    };
  };
  const slice = (recs) => Object.fromEntries(CONDITIONS.map((c) => [c.key, aggregate(recs, c.key)]));
  const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const summary = {};
  for (const split of ['tune', 'test']) {
    const recs = records.filter((r) => r.split === split);
    summary[split] = {
      n: recs.length,
      all: slice(recs),
      vague: { n: recs.filter((r) => 'CD'.includes(r.group)).length, ...slice(recs.filter((r) => 'CD'.includes(r.group))) },
      byGroup: Object.fromEntries(GROUPS.map((g) => [g, { n: recs.filter((r) => r.group === g).length, ...slice(recs.filter((r) => r.group === g)) }])),
    };
  }

  // control: on structured-filter questions keyword and the app default must return the same rows
  const groupA = records.filter((r) => r.group === 'A');
  const control = {
    keywordEqualsApp: groupA.every((r) => JSON.stringify(r.conditions.keyword.retrieval.rowIds) === JSON.stringify(r.conditions.app.retrieval.rowIds)),
    perQuestion: groupA.map((r) => ({
      id: r.id, split: r.split, gold: r.goldCount, goldBelowSemMin: r.goldCosine ? r.goldCosine.belowSemMin : null,
      ...Object.fromEntries(CONDITIONS.map((c) => [c.key, { mode: r.conditions[c.key].retrieval.mode, goldInCandidates: r.conditions[c.key].retrieval.goldInCandidates, recall: floor4(r.conditions[c.key].retrieval.recall) }])),
    })),
  };

  let commit = null; let dirty = null;
  try {
    commit = execSync('git rev-parse HEAD', { cwd: path.resolve(__dirname, '..') }).toString().trim();
    dirty = execSync('git status --porcelain -- src eval/run-eval.js eval/lib eval/questions.json', { cwd: path.resolve(__dirname, '..') }).toString().trim().split('\n').filter(Boolean);
  } catch { /* not a git checkout */ }

  const result = {
    label: LABEL, ranAt: new Date().toISOString(), commit, uncommittedChanges: dirty,
    config: { k: K, weight: WEIGHT, semMin: SEM_MIN, env: ENV, conditions: CONDITIONS, answerBackend: 'rules', node: process.version },
    snapshot: { sha256: hashBefore.sha256, rows: hashBefore.rows, unchangedAfterRun: true },
    datasets, ollama, summary, control, questions: records,
  };

  // ---- report --------------------------------------------------------------------------------
  const f = (x) => (x == null ? 'n/a' : x.toFixed(4));
  const row = (name, n, s) => `| ${name} | ${n} | ${f(s.recallAt20)} | ${s.hits}/${s.nRetrieval} (${f(s.hitRate)}) | ${f(s.precisionAt20)} | ${f(s.mrr)} | ${s.nAbstain ? `${s.abstainOk}/${s.nAbstain}` : 'n/a'} | ${s.answerCorrect}/${s.nAnswer} (${f(s.answerRate)}) |`;
  const head = (first) => [`| ${first} | questions | Recall@20 | Hit rate | P@20 | MRR | abstain ok (G) | answer correct |`, '|---|---|---|---|---|---|---|---|'];
  const md = [];
  md.push(`# Retrieval eval: ${LABEL}`, '');
  md.push(`- run: ${result.ranAt} · commit ${commit}${dirty && dirty.length ? ` (+${dirty.length} uncommitted file(s))` : ''} · node ${process.version}`);
  md.push(`- snapshot content sha256: \`${hashBefore.sha256}\` (users ${hashBefore.rows.users}, transactions ${hashBefore.rows.transactions}, tx_embed ${hashBefore.rows.tx_embed}; unchanged after the run)`);
  md.push(`- embedding model: ${ollama.embedModel.name} \`${ollama.embedModel.digest}\` · Ollama ${ollama.version}`);
  md.push(`- chat model: ${ollama.chatModel ? `${ollama.chatModel.name} \`${ollama.chatModel.digest}\`` : 'not installed'} (not used in this run; answers come from the rules backend)`);
  for (const [name, d] of Object.entries(datasets)) md.push(`- dataset ${name}: ${d.transactions} transactions, ${d.embedded} embedded, pinned default month ${d.defaultMonth}`);
  md.push(`- k = ${K}; blended weight = ${WEIGHT}; cosine cut-off (semMin) = ${SEM_MIN}`);
  md.push('- Recall@20, P@20 and MRR are means over questions with gold rows (group G excluded); values are rounded down to 4 decimals.', '');
  const titles = { tune: 'Tuning set', test: 'Held-out set' };
  for (const split of ['tune', 'test']) {
    const s = summary[split];
    md.push(`## ${titles[split]} (${s.n} questions)`, '');
    if (split === 'test') md.push(`The held-out set contains ${s.vague.n} vague questions (${s.byGroup.C.n} in group C, ${s.byGroup.D.n} in group D).`, '');
    md.push(...head('condition'));
    for (const c of CONDITIONS) md.push(row(c.label, s.n, s.all[c.key]));
    md.push('', `Vague questions only (groups C and D, ${s.vague.n} questions):`, '', ...head('condition'));
    for (const c of CONDITIONS) md.push(row(c.label, s.vague.n, s.vague[c.key]));
    md.push('', 'By group:', '', ...head('group / condition'));
    for (const g of GROUPS) for (const c of CONDITIONS) md.push(row(`${g} · ${c.label}`, s.byGroup[g].n, s.byGroup[g][c.key]));
    md.push('');
  }
  md.push('## Control: structured-filter questions (group A)', '');
  md.push(`Keyword and app default return identical rows on all ${groupA.length} group A questions: ${control.keywordEqualsApp ? 'yes' : 'NO'}.`, '');
  md.push('| id | split | gold rows | gold below cut-off | keyword recall | semantic recall | blended recall | app recall | gold surviving filters |', '|---|---|---|---|---|---|---|---|---|');
  for (const p of control.perQuestion) md.push(`| ${p.id} | ${p.split} | ${p.gold} | ${p.goldBelowSemMin} | ${f(p.keyword.recall)} | ${f(p.semantic.recall)} | ${f(p.blended.recall)} | ${f(p.app.recall)} | ${p.keyword.goldInCandidates}/${p.gold} |`);
  md.push('', '## Per question', '', '| id | split | gold | filters→gold kept | keyword R@20 | semantic R@20 | blended R@20 | app R@20 | answer route | answer ok (kw/sem/bl/app) |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of records) {
    const c = r.conditions;
    const rr = (k) => (r.group === 'G' ? (c[k].retrieval.abstainOk ? 'none ✓' : `${c[k].retrieval.returned} rows ✗`) : f(floor4(c[k].retrieval.recall)));
    md.push(`| ${r.id} | ${r.split} | ${r.goldCount} | ${c.keyword.retrieval.goldInCandidates}/${r.goldCount} | ${rr('keyword')} | ${rr('semantic')} | ${rr('blended')} | ${rr('app')} | ${c.app.answer.route} | ${CONDITIONS.map((x) => (c[x.key].answer.correct ? '✓' : '✗')).join(' ')} |`);
  }
  md.push('');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${LABEL}.json`), JSON.stringify(result, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, `${LABEL}.md`), md.join('\n'));
  console.log(md.join('\n'));
})().catch((e) => { console.error(`ABORTED: ${e.stack || e.message}`); process.exit(1); });
