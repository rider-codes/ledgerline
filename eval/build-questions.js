#!/usr/bin/env node
'use strict';

// Builds eval/questions.json (the 50 questions), eval/labeling-pools.json and eval/labeling-worksheet.md
// from the specs below, against the eval snapshot. Re-runnable: gold ids and expected values are always
// regenerated from SQL / analytics.js, never typed.
//
//   node --experimental-sqlite eval/build-questions.js
//
// Groups: A structured filters · B merchant/name variants · C vague phrasing · D vague + filter ·
//         E dates/ranges (known gaps) · F aggregates over retrieved rows · G unanswerable.
// Gold for A, B, E, F, G is SQL (the question names a category, merchant or date range outright).
// Gold for C and D is manual: a human ticks the merchants the question is asking about. The category
// column is never used to build C/D gold or their candidate pools.

const fs = require('node:fs');
const path = require('node:path');
const { requireSnapshotDb } = require('./lib/guard');

process.env.DB_PATH = process.env.DB_PATH || path.resolve(__dirname, 'snapshots', 'eval.db');
requireSnapshotDb(); // refuse to run on the live DB — must precede any require of ../src
process.env.EMBED_ENABLED = 'true';
process.env.CURRENCY = '₹';

const { db } = require('../src/db');
const A = require('../src/analytics');
const embed = require('../src/embed');
const { computeExpected } = require('./lib/gold');

const SPLIT_SEED = 7351;
// Held-out quota per group (15 test / 35 tune). Revised before any retrieval number existed: the vague
// groups, where keyword and semantic are expected to differ, were widened from C3/D2 to C4/D3, paid for by
// A3->A2 and F2->F1 (the groups least likely to separate the three conditions) so the total stays 15.
// The seeded shuffle is untouched, so each group's earlier test picks are a prefix of the new ones.
const TEST_QUOTA = { A: 2, B: 2, C: 4, D: 3, E: 2, F: 1, G: 1 };
const EXHAUSTIVE_MAX = 60; // a month with <= this many expense rows is listed in full for labelling
const POOL_SEMANTIC_TOP = 20;
const NET_GROUP_CAP = 25;

const EXP = "type = 'expense'";
const W = 'user_id = :userId';
const month = (ym) => `substr(date,1,7) = '${ym}'`;

const COUNT = { type: 'count', source: { goldCount: true } };
const SUM = { type: 'number', source: { goldSum: true } };
const ABSTAIN = { type: 'abstain' };

/* ---------------------------------------------------------------- specs ---------------------------------------------------------------- */

const sqlGold = (id, ds, group, question, where, answer, extra = {}) => ({ id, ds, group, question, sql: `SELECT id FROM transactions WHERE ${W} AND ${where}`, answer, ...extra });
const manual = (id, ds, group, question, net, extra = {}) => ({ id, ds, group, question, manual: { net, ...extra }, answer: SUM });

const SPECS = [
  // ---- A: structured filters (category / month / amount / type named outright) ----
  sqlGold('A-01', 'demo', 'A', 'list my groceries charges over 60 in july', `${EXP} AND category = 'Groceries' AND amount > 60 AND ${month('2026-07')}`, COUNT, { boundary: true }),
  sqlGold('A-02', 'demo', 'A', 'show me shopping charges in august', `${EXP} AND category = 'Shopping' AND ${month('2026-08')}`, COUNT),
  sqlGold('A-03', 'demo', 'A', 'how much did I spend on dining in august', `${EXP} AND category = 'Dining' AND ${month('2026-08')}`,
    { type: 'number', source: { analytics: "A.categoryBreakdown(userId,'2026-08').find(c => c.category === 'Dining').amount" } }),
  sqlGold('A-04', 'demo', 'A', 'list subscriptions charges under 10', `${EXP} AND category = 'Subscriptions' AND amount < 10`, COUNT, { boundary: true }),
  sqlGold('A-05', 'demo', 'A', 'show me income deposits in august', `type = 'income' AND ${month('2026-08')}`, COUNT),
  sqlGold('A-06', 'real', 'A', 'list housing charges', `${EXP} AND category = 'Housing'`, COUNT),
  sqlGold('A-07', 'real', 'A', 'show me education charges', `${EXP} AND category = 'Education'`, COUNT),
  sqlGold('A-08', 'real', 'A', 'list shopping charges over 1000', `${EXP} AND category = 'Shopping' AND amount > 1000`, COUNT, { boundary: true }),
  sqlGold('A-09', 'real', 'A', 'how much did I spend on health in march 2018', `${EXP} AND category = 'Health' AND ${month('2018-03')}`,
    { type: 'number', source: { analytics: "A.categoryBreakdown(userId,'2018-03').find(c => c.category === 'Health').amount" } }),
  sqlGold('A-10', 'real', 'A', 'show me income deposits over 50000', `type = 'income' AND amount > 50000`, COUNT, { boundary: true }),

  // ---- B: merchant / name variants (apostrophes, partial names, typos, older names) ----
  sqlGold('B-01', 'demo', 'B', 'show me my Trader Joes purchases', `${EXP} AND merchant LIKE 'Trader Joe%'`, COUNT),
  sqlGold('B-02', 'demo', 'B', 'list Comcast charges', `${EXP} AND merchant LIKE 'Comcast%'`, COUNT),
  sqlGold('B-03', 'demo', 'B', 'show me whole foods charges', `${EXP} AND merchant LIKE 'Whole Foods%'`, COUNT),
  sqlGold('B-04', 'demo', 'B', 'list my Netflicks charges', `${EXP} AND merchant = 'Netflix'`, COUNT, { notes: 'Deliberate typo for Netflix.' }),
  sqlGold('B-05', 'real', 'B', 'show me every Dominos Pizza order', `${EXP} AND merchant LIKE 'Domino%'`, COUNT),
  sqlGold('B-06', 'real', 'B', 'list my Tata Play recharges', `${EXP} AND lower(merchant) LIKE '%tata play%'`, COUNT, { notes: 'Merchant text varies by residence prefix; an older "Tata Sky" label is deliberately NOT gold.' }),
  sqlGold('B-07', 'real', 'B', 'show me every milk 1lit purchase', `${EXP} AND lower(merchant) = 'milk 1lit'`, SUM),
  sqlGold('B-08', 'real', 'B', 'list gupta bhel purchases', `${EXP} AND lower(merchant) LIKE '%gupta bhel%'`, COUNT),

  // ---- C: vague phrasing, no category/merchant named (manual gold) ----
  manual('C-01', 'demo', 'C', 'what did I spend on takeout?', /doordash|chipotle|curry up|sweetgreen|marufuku|ramen|takeout|delivery|pizza|burrito/i),
  manual('C-02', 'demo', 'C', 'how much did I spend on getting around town?', /bart|lyft|uber|shell|chevron|transit|parking|taxi|gas/i),
  manual('C-03', 'demo', 'C', 'what do I pay for streaming and media?', /netflix|spotify|audible|icloud|hulu|disney|youtube|streaming/i),
  manual('C-04', 'demo', 'C', 'how much goes on gym and fitness?', /fitness|gym|yoga|planet|rei|peloton|sport/i),
  manual('C-05', 'demo', 'C', 'what are my medical and pharmacy costs?', /kaiser|walgreens|cvs|pharmac|clinic|doctor|medic|dental|hospital/i),
  manual('C-06', 'demo', 'C', 'how much did I spend on coffee shop visits?', /coffee|philz|blue bottle|cafe|tartine|bakery|espresso|starbucks/i),
  manual('C-07', 'real', 'C', 'what did I spend on chai and snacks?', /tea\b|chai|chocobar|vadapav|khari|toast|panipuri|kachori|bhel|biscuit|samosa|snack|namkeen|chips/i, { netCap: 12, semTop: 8 }),
  manual('C-08', 'real', 'C', 'how much did I spend on phone and TV recharges?', /recharge|mobile service|data booster|tata|dth|broadband|internet|freedom pack|sim\b/i, { netCap: 12, semTop: 8 }),
  manual('C-09', 'real', 'C', 'what did I spend on daily milk?', /milk|\blit\b|liter|buffalo|dairy|curd/i, { netCap: 12, semTop: 8 }),
  manual('C-10', 'real', 'C', 'how much did I spend on street food and sweets?', /vadapav|pani ?puri|bhel|kachori|sugarcane|juice|ice ?cream|sweet|jalebi|pav\b|chaat|golgappa|dosa/i, { netCap: 12, semTop: 8 }),
  manual('C-11', 'real', 'C', 'what did I spend on doctor and medicine?', /medicine|doctor|koflet|painkiller|pharmac|tablet|syrup|clinic|dental|hospital|cough/i, { netCap: 12, semTop: 8 }),
  manual('C-12', 'real', 'C', 'how much did I spend on personal grooming?', /hair ?cut|shav|salon|barber|razor|soap|trimmer|beard|spa\b/i, { netCap: 12, semTop: 8 }),

  // ---- D: vague phrasing + a month filter (manual gold within that month) ----
  manual('D-01', 'demo', 'D', 'coffee shops in august', /coffee|philz|blue bottle|cafe|tartine|bakery|espresso|starbucks/i, { month: '2026-08' }),
  manual('D-02', 'demo', 'D', 'ride sharing and transit in july', /bart|lyft|uber|transit|taxi|cab\b/i, { month: '2026-07' }),
  manual('D-03', 'demo', 'D', 'online shopping in august', /amazon|target|best buy|uniqlo|rei|online/i, { month: '2026-08' }),
  manual('D-04', 'real', 'D', 'chai and snacks in september', /tea\b|chai|chocobar|vadapav|khari|toast|panipuri|kachori|bhel|biscuit|samosa|snack|namkeen/i, { month: '2018-09' }),
  manual('D-05', 'real', 'D', 'travel to work in august', /residence|place|within city|auto\b|bus\b|metro|cab\b|travel|commute|work/i, { month: '2018-08' }),
  manual('D-06', 'real', 'D', 'doctor and medicine in june', /medicine|doctor|koflet|painkiller|pharmac|tablet|syrup|clinic|dental|hospital|cough/i, { month: '2018-06' }),

  // ---- E: dates and ranges the parser does not support (known gaps) ----
  sqlGold('E-01', 'demo', 'E', 'how much did I spend on transport between june and july', `${EXP} AND category = 'Transport' AND substr(date,1,7) BETWEEN '2026-06' AND '2026-07'`, SUM, { knownGap: true, notes: 'Month range.' }),
  sqlGold('E-02', 'demo', 'E', 'how much did I spend on shopping since july', `${EXP} AND category = 'Shopping' AND date >= '2026-07-01'`, SUM, { knownGap: true, notes: 'Open-ended range.' }),
  sqlGold('E-03', 'real', 'E', 'how much did I spend on dining in 2017', `${EXP} AND category = 'Dining' AND substr(date,1,4) = '2017'`, SUM, { knownGap: true, notes: 'Year-only filter.' }),
  sqlGold('E-04', 'real', 'E', 'list transport charges in the first half of 2018', `${EXP} AND category = 'Transport' AND date BETWEEN '2018-01-01' AND '2018-06-30'`, COUNT, { knownGap: true, notes: 'Half-year range.' }),
  sqlGold('E-05', 'demo', 'E', 'list my dining charges on weekends in august', `${EXP} AND category = 'Dining' AND ${month('2026-08')} AND strftime('%w', date) IN ('0','6')`, COUNT, { knownGap: true, notes: 'Day-of-week filter.' }),

  // ---- F: aggregate over the retrieved rows (sum / count of one merchant) ----
  sqlGold('F-01', 'demo', 'F', 'how much have I spent at Amazon in total?', `${EXP} AND merchant = 'Amazon'`, SUM),
  sqlGold('F-02', 'demo', 'F', 'how many times did I go to Philz Coffee?', `${EXP} AND merchant = 'Philz Coffee'`, COUNT),
  sqlGold('F-03', 'demo', 'F', 'what is my total spend at Ticketmaster?', `${EXP} AND merchant = 'Ticketmaster'`, SUM),
  sqlGold('F-04', 'real', 'F', 'how much have I spent on milk 1lit in total?', `${EXP} AND lower(merchant) = 'milk 1lit'`, SUM),
  sqlGold('F-05', 'real', 'F', 'how many times did I get a Gpay reward?', `type = 'income' AND lower(merchant) LIKE '%gpay%'`, COUNT, { notes: 'Two spellings in the data ("Gpay Reward", "reward Gpay"); both are gold.' }),
  sqlGold('F-06', 'real', 'F', 'how much have I paid for maid in total?', `${EXP} AND lower(merchant) = 'maid'`, SUM),

  // ---- G: unanswerable — the right behaviour is to say nothing matched ----
  sqlGold('G-01', 'demo', 'G', 'show me my Tesla charges', `lower(merchant || ' ' || note) LIKE '%tesla%'`, ABSTAIN, { notes: 'No such merchant.' }),
  sqlGold('G-02', 'demo', 'G', 'how much did I spend in december', `${month('2026-12')}`, ABSTAIN, { notes: 'The demo data has no December.' }),
  sqlGold('G-03', 'real', 'G', 'list my Starbucks purchases', `lower(merchant || ' ' || note) LIKE '%starbucks%'`, ABSTAIN, { notes: 'No such merchant.' }),
];

/* ---------------------------------------------------------------- helpers ---------------------------------------------------------------- */

const userId = {};
for (const [name, email] of [['demo', 'demo@example.com'], ['real', 'real@example.com']]) {
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!u) throw new Error(`user ${email} missing from the snapshot`);
  userId[name] = u.id;
}
const idsOf = (sql, uid) => db.prepare(sql).all({ userId: uid }).map((r) => r.id);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Stratified, seeded 35/15 split — fixed here, before any retrieval number exists.
function assignSplits(specs) {
  const rnd = mulberry32(SPLIT_SEED);
  const split = {};
  for (const g of Object.keys(TEST_QUOTA)) {
    const inGroup = specs.filter((s) => s.group === g).sort((p, q) => p.id.localeCompare(q.id));
    const pools = { demo: shuffled(inGroup.filter((s) => s.ds === 'demo'), rnd), real: shuffled(inGroup.filter((s) => s.ds === 'real'), rnd) };
    let turn = rnd() < 0.5 ? 'demo' : 'real';
    const picked = [];
    while (picked.length < TEST_QUOTA[g]) {
      const from = pools[turn].length ? turn : (turn === 'demo' ? 'real' : 'demo');
      picked.push(pools[from].shift());
      turn = turn === 'demo' ? 'real' : 'demo';
    }
    for (const s of inGroup) split[s.id] = picked.includes(s) ? 'test' : 'tune';
  }
  return split;
}

// Candidate pool for manual labelling, grouped by exact merchant text.
async function buildPool(spec) {
  const uid = userId[spec.ds];
  const monthSql = spec.manual.month ? 'AND substr(date,1,7) = ?' : '';
  const args = spec.manual.month ? [uid, spec.manual.month] : [uid];
  const rows = db.prepare(`SELECT id, date, amount, type, category, merchant, note FROM transactions WHERE user_id = ? AND type = 'expense' ${monthSql} ORDER BY date, id`).all(...args);
  const label = (r) => (r.merchant || r.note || '(no merchant text)').trim();
  let method;
  let chosen;
  if (spec.manual.month && rows.length <= EXHAUSTIVE_MAX) {
    chosen = rows;
    method = `exhaustive — every expense row in ${spec.manual.month} (${rows.length} rows)`;
  } else {
    // keyword net: my own hand-written pattern, independent of src/retrieve.js. Capped to the
    // NET_GROUP_CAP most frequent merchant texts so the worksheet stays a human-sized job.
    const netRows = rows.filter((r) => spec.manual.net.test(`${r.merchant} ${r.note}`));
    const netCount = new Map();
    for (const r of netRows) netCount.set(label(r), (netCount.get(label(r)) || 0) + 1);
    const netCap = spec.manual.netCap || NET_GROUP_CAP;
    const semTop = spec.manual.semTop || POOL_SEMANTIC_TOP;
    const netKeep = new Set([...netCount.entries()].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0])).slice(0, netCap).map((e) => e[0]));
    const net = netRows.filter((r) => netKeep.has(label(r)));
    // embedding pool: the current retriever's own top matches (this IS pooling from the system under test)
    const sem = await embed.semanticScores(rows, spec.question, { readOnly: true, strict: true });
    const top = rows.map((r) => ({ r, s: sem.get(r.id) })).sort((p, q) => q.s - p.s).slice(0, semTop).map((x) => x.r);
    const seen = new Set();
    chosen = [...net, ...top].filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
    method = `pooled — hand-written keyword net (${netCount.size} merchant texts match; the ${Math.min(netCount.size, netCap)} most frequent shown) ∪ merchants of the top ${semTop} rows by embedding similarity, over ${rows.length} expense rows${spec.manual.month ? ` in ${spec.manual.month}` : ''}`;
  }
  const keep = new Set(chosen.map(label));
  const byMerchant = new Map();
  for (const r of rows) {
    const k = label(r);
    if (!keep.has(k)) continue;
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push(r);
  }
  const groups = [...byMerchant.entries()]
    .sort((p, q) => p[0].toLowerCase().localeCompare(q[0].toLowerCase()))
    .map(([merchant, rs]) => ({
      merchant, n: rs.length, total: Math.round(rs.reduce((t, r) => t + r.amount, 0) * 100) / 100,
      ids: rs.map((r) => r.id),
      examples: rs.slice(0, 3).map((r) => `${r.date} ₹${r.amount}`),
    }));
  // every merchant text in scope -> its row ids, so a human can add a merchant that was not shown
  const scopeIds = {};
  for (const r of rows) (scopeIds[label(r)] = scopeIds[label(r)] || []).push(r.id);
  return { method, scopeRows: rows.length, scopeIds, groups };
}

/* ---------------------------------------------------------------- build ---------------------------------------------------------------- */

(async () => {
  if (SPECS.length !== 50) throw new Error(`expected 50 specs, found ${SPECS.length}`);
  const split = assignSplits(SPECS);
  const questions = [];
  const pools = {};
  const warnings = [];

  for (const s of SPECS) {
    const uid = userId[s.ds];
    const q = { id: s.id, group: s.group, dataset: s.ds, split: split[s.id], question: s.question };
    if (s.knownGap) q.knownGap = true;
    if (s.notes) q.notes = s.notes;

    if (s.sql) {
      const goldIds = idsOf(s.sql, uid);
      if (s.group === 'G' && goldIds.length) warnings.push(`${s.id}: expected NO matching rows but SQL found ${goldIds.length}`);
      if (s.group !== 'G' && !goldIds.length) warnings.push(`${s.id}: SQL gold is empty`);
      if (s.boundary) {
        // "over 60" must not depend on whether 60.00 counts: the inclusive version of the same filter must match
        const inclusive = idsOf(s.sql.replace(/amount ([<>]) /, 'amount $1= '), uid);
        if (inclusive.length !== goldIds.length) warnings.push(`${s.id}: ${inclusive.length - goldIds.length} row(s) sit exactly on the amount threshold ("over/under" is ambiguous there)`);
      }
      q.retrieval = { goldBasis: 'sql', sql: s.sql, goldIds, labelStatus: 'confirmed' };
    } else {
      const pool = await buildPool(s);
      pools[s.id] = pool;
      if (!pool.groups.length) warnings.push(`${s.id}: empty candidate pool`);
      q.retrieval = {
        goldBasis: 'manual', goldIds: [], labelStatus: 'draft',
        candidateIds: pool.groups.flatMap((g) => g.ids),
        labelNotes: `Candidate pool — ${pool.method}. Candidates are suggestions only and are never scored.`,
      };
    }

    q.answer = { ...s.answer, source: s.answer.source ? { ...s.answer.source } : undefined };
    if (q.answer.source === undefined) delete q.answer.source;
    if (q.answer.type !== 'abstain') {
      q.answer.tolerance = q.answer.type === 'count' ? 0 : 0.01;
      if (q.retrieval.labelStatus === 'confirmed') q.answer.expected = computeExpected(q, { db, A, userId: uid });
    }
    questions.push(q);
  }

  const doc = {
    meta: {
      version: 1, k: 20, splitSeed: SPLIT_SEED,
      datasets: { demo: { userEmail: 'demo@example.com', defaultMonth: null }, real: { userEmail: 'real@example.com', defaultMonth: null } },
      snapshotSha256: null,
    },
    questions,
  };
  const out = (f) => path.resolve(__dirname, f);

  // Never clobber human work: refuse to regenerate over confirmed labels or ticked boxes.
  if (!process.argv.includes('--force')) {
    const hand = [];
    try {
      const prev = JSON.parse(fs.readFileSync(out('questions.json'), 'utf8'));
      for (const pq of prev.questions) if (pq.retrieval && pq.retrieval.goldBasis === 'manual' && pq.retrieval.labelStatus === 'confirmed') hand.push(pq.id);
    } catch { /* no previous file */ }
    let ticks = 0;
    try { ticks = (fs.readFileSync(out('labeling-worksheet.md'), 'utf8').match(/^- \[[xX]\]/gm) || []).length; } catch { /* none */ }
    if (hand.length || ticks) {
      throw new Error(`refusing to overwrite hand labels (${hand.length} confirmed question(s), ${ticks} ticked box(es)). Re-run with --force to discard them.`);
    }
  }
  fs.writeFileSync(out('questions.json'), JSON.stringify(doc, null, 2) + '\n');
  fs.writeFileSync(out('labeling-pools.json'), JSON.stringify(pools, null, 2) + '\n');

  // ---- worksheet for the human labeller ----
  const w = [];
  w.push('# Labelling worksheet — questions C-01…C-12 and D-01…D-06', '');
  w.push('For each question, **tick every merchant whose transactions the question is asking about** (change `[ ]` to `[x]`).');
  w.push('Rules:', '- Judge by what the question *means*, not by the category shown. Categories are classifier output and are wrong in places (e.g. `grocery` is filed under Dining).');
  w.push('- A tick counts **every** expense row with that exact merchant text. If one text means two different things, say so in the note line and I will split it.');
  w.push('- Nothing is pre-ticked and the order is alphabetical, not by any retrieval score.');
  w.push('- If a relevant merchant is missing from the list, add its exact text on the "Also include" line (separate several with `;`).');
  w.push('- If a question has nothing relevant at all, leave it unticked and write `none` on the Note line.');
  w.push('- "pooled" lists are not exhaustive (a keyword net I wrote by hand plus the top embedding matches), so recall of gold is bounded by what is shown. "exhaustive" lists show every expense row in the month.', '');
  for (const q of questions.filter((x) => x.retrieval.goldBasis === 'manual')) {
    const p = pools[q.id];
    w.push(`## ${q.id} · ${q.dataset} · "${q.question}"`, '');
    w.push(`_${p.method}_`, '');
    const ex = p.method.match(/^exhaustive — every expense row in (\d{4}-\d{2}) \((\d+) rows\)/);
    if (ex) {
      w.push(`> **Exhaustive for ${ex[1]}.** This list contains every expense row in that month (${ex[2]} rows), so nothing outside it can be relevant. Check every box carefully: an unticked box means "the question is not asking about this".`, '');
    }
    p.groups.forEach((g, i) => {
      w.push(`- [ ] **${g.merchant}** — ${g.n} row${g.n > 1 ? 's' : ''}, ₹${g.total}; e.g. ${g.examples.join(', ')} ⟨${String(i).padStart(2, '0')}⟩`);
    });
    w.push('', 'Also include (exact merchant text, separated by `;`): ', 'Note: ', '');
  }
  fs.writeFileSync(out('labeling-worksheet.md'), w.join('\n'));

  // ---- report ----
  console.log('id    ds    split  gold  expected / candidates');
  for (const q of questions) {
    const gold = q.retrieval.labelStatus === 'confirmed' ? String(q.retrieval.goldIds.length) : '(draft)';
    const tail = q.answer.expected !== undefined ? q.answer.expected : q.retrieval.labelStatus === 'draft' ? `${pools[q.id].groups.length} merchant groups / ${q.retrieval.candidateIds.length} rows` : q.answer.type;
    console.log(`${q.id}  ${q.dataset.padEnd(5)} ${q.split.padEnd(5)}  ${gold.padEnd(7)} ${tail}`);
  }
  const by = (f) => questions.reduce((m, q) => ((m[f(q)] = (m[f(q)] || 0) + 1), m), {});
  console.log('\nsplit:', JSON.stringify(by((q) => q.split)), '| dataset:', JSON.stringify(by((q) => q.dataset)), '| group:', JSON.stringify(by((q) => q.group)));
  console.log('test items:', questions.filter((q) => q.split === 'test').map((q) => q.id).join(' '));
  if (warnings.length) { console.log('\nWARNINGS'); warnings.forEach((x) => console.log(' - ' + x)); }
  process.exit(warnings.length ? 1 : 0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
