#!/usr/bin/env node
'use strict';

// Side-by-side view of eval runs, in the order given, plus which questions changed between
// consecutive runs.   node eval/compare.js baseline fix1-totals fix2-months ...

const fs = require('node:fs');
const path = require('node:path');

const labels = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (labels.length < 1) { console.error('usage: compare.js <label> [<label> ...]'); process.exit(2); }
const runs = labels.map((l) => JSON.parse(fs.readFileSync(path.resolve(__dirname, 'results', `${l}.json`), 'utf8')));
const CONDS = runs[0].config.conditions.map((c) => c.key);
const f = (x) => (x == null ? 'n/a' : x.toFixed(4));
const out = [];

for (const [split, title] of [['tune', 'Tuning set'], ['test', 'Held-out set']]) {
  out.push(`## ${title} (${runs[0].summary[split].n} questions)`, '');
  for (const c of CONDS) {
    out.push(`**${c}**`, '', '| run | Recall@20 | Hit rate | P@20 | MRR | abstain ok | answer correct |', '|---|---|---|---|---|---|---|');
    for (const r of runs) {
      const s = r.summary[split].all[c];
      out.push(`| ${r.label} | ${f(s.recallAt20)} | ${s.hits}/${s.nRetrieval} | ${f(s.precisionAt20)} | ${f(s.mrr)} | ${s.abstainOk}/${s.nAbstain} | ${s.answerCorrect}/${s.nAnswer} |`);
    }
    out.push('');
  }
}

out.push('## Questions that changed between consecutive runs', '');
const cell = (q, c) => (q.group === 'G' ? (q.conditions[c].retrieval.abstainOk ? 'none' : `${q.conditions[c].retrieval.returned}rows`) : f(Math.floor(q.conditions[c].retrieval.recall * 1e4 + 1e-9) / 1e4));
for (let i = 1; i < runs.length; i++) {
  const a = runs[i - 1], b = runs[i];
  out.push(`### ${a.label} → ${b.label}`, '');
  const lines = [];
  for (const qb of b.questions) {
    const qa = a.questions.find((q) => q.id === qb.id);
    const parts = [];
    for (const c of CONDS) {
      const ra = qa.conditions[c].retrieval, rb = qb.conditions[c].retrieval;
      const bits = [];
      if (cell(qa, c) !== cell(qb, c)) bits.push(`recall ${cell(qa, c)}→${cell(qb, c)}`);
      else if (JSON.stringify(ra.rowIds) !== JSON.stringify(rb.rowIds)) bits.push(`rows differ (P@20 ${f(ra.precision)}→${f(rb.precision)})`);
      if (qa.conditions[c].answer.correct !== qb.conditions[c].answer.correct) bits.push(`answer ${qa.conditions[c].answer.correct ? '✓' : '✗'}→${qb.conditions[c].answer.correct ? '✓' : '✗'}`);
      else if (qa.conditions[c].answer.reply !== qb.conditions[c].answer.reply) bits.push('reply text changed');
      if (bits.length) parts.push(`${c}: ${bits.join(', ')}`);
    }
    if (parts.length) lines.push(`- ${qb.id} (${qb.split}) — ${parts.join(' | ')}`);
  }
  out.push(...(lines.length ? lines : ['- no question changed']), '');
}
console.log(out.join('\n'));
