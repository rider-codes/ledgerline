'use strict';

// Scoring rules, exactly as fixed in eval/FORMAT.md before any baseline was run.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Retrieval metrics for one question. `rowIds` is the ranked list returned by retrieve() (already cut to k).
function retrievalMetrics(rowIds, goldIds, k) {
  const gold = new Set(goldIds);
  const top = rowIds.slice(0, k);
  const hits = top.filter((id) => gold.has(id)).length;
  const first = top.findIndex((id) => gold.has(id));
  return {
    returned: top.length,
    goldInTop: hits,
    recall: gold.size ? hits / Math.min(gold.size, k) : null,
    hit: hits > 0,
    precision: top.length ? hits / top.length : 0, // nothing returned -> 0
    mrr: first >= 0 ? 1 / (first + 1) : 0,
    firstGoldRank: first >= 0 ? first + 1 : null,
  };
}

// Every currency-prefixed number in the reply, thousands separators stripped.
function parseAmounts(reply, currency) {
  const re = new RegExp(`${escapeRe(currency)}\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`, 'g');
  return [...String(reply).matchAll(re)].map((m) => Number(m[1].replace(/,/g, ''))).filter(Number.isFinite);
}

const COUNT_RE = /(\d[\d,]*)\s+(?:transactions?|charges?|purchases?|orders?|payments?|rows?)\b/i;
const ABSTAIN_RE = /couldn'?t find|no (transactions?|spending|expenses?|data|records?)|nothing|none|don'?t see/i;

// -> { correct, got }  (`got` is what the judge read out of the reply, for the log)
function judgeAnswer(answer, reply, currency) {
  const text = String(reply || '');
  if (answer.type === 'abstain') return { correct: ABSTAIN_RE.test(text), got: ABSTAIN_RE.test(text) ? 'abstained' : 'answered' };
  if (answer.type === 'count') {
    const m = text.match(COUNT_RE);
    const got = m ? Number(m[1].replace(/,/g, '')) : null;
    return { correct: got !== null && Math.abs(got - answer.expected) <= (answer.tolerance ?? 0), got };
  }
  const amounts = parseAmounts(text, currency);
  const tol = answer.tolerance ?? 0.01;
  const match = amounts.find((a) => Math.abs(a - answer.expected) <= tol + 1e-9);
  return { correct: match !== undefined, got: match !== undefined ? match : amounts.slice(0, 6) };
}

// Round DOWN to 4 decimal places (never up).
const floor4 = (x) => (x == null ? null : Math.floor(x * 1e4 + 1e-9) / 1e4);

module.exports = { retrievalMetrics, parseAmounts, judgeAnswer, floor4, COUNT_RE, ABSTAIN_RE };
