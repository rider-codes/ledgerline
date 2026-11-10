'use strict';
// node --test eval/score.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { retrievalMetrics, parseAmounts, judgeAnswer, floor4 } = require('./lib/score');

test('retrieval metrics', () => {
  const m = retrievalMetrics([9, 1, 8, 2], [1, 2, 3], 20);
  assert.equal(m.goldInTop, 2);
  assert.equal(m.recall, 2 / 3);
  assert.equal(m.precision, 2 / 4);
  assert.equal(m.mrr, 1 / 2);
  assert.equal(m.hit, true);
});

test('recall denominator is min(|gold|, k)', () => {
  const gold = Array.from({ length: 67 }, (_, i) => i + 1);
  const top = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(retrievalMetrics(top, gold, 20).recall, 1);
});

test('nothing returned scores zero, not NaN', () => {
  const m = retrievalMetrics([], [1, 2], 20);
  assert.deepEqual([m.recall, m.precision, m.mrr, m.hit], [0, 0, 0, false]);
});

test('only the top k rows count', () => {
  const ids = Array.from({ length: 30 }, (_, i) => i + 100);
  ids[25] = 1;
  assert.equal(retrievalMetrics(ids, [1], 20).hit, false);
});

test('amount parsing needs the currency symbol', () => {
  assert.deepEqual(parseAmounts('Dining in Aug 2026: ₹560.50 across 28 transactions — 44% (₹1,750.00, ₹-12.5).', '₹'), [560.5, 1750, -12.5]);
  assert.deepEqual(parseAmounts('2026-08-01 28 transactions', '₹'), []);
  assert.deepEqual(parseAmounts('$5 and $1,200.25', '$'), [5, 1200.25]);
});

test('number answers: any amount within one paisa', () => {
  const a = { type: 'number', expected: 560.5, tolerance: 0.01 };
  assert.equal(judgeAnswer(a, 'You spent ₹560.50 on dining.', '₹').correct, true);
  assert.equal(judgeAnswer(a, 'You spent ₹561 on dining.', '₹').correct, false);
  assert.equal(judgeAnswer(a, 'You spent 560.50 on dining.', '₹').correct, false);
  assert.equal(judgeAnswer(a, 'Found 20 transaction(s), ₹396.35 spent:', '₹').correct, false);
});

test('count answers: first integer before a transaction word', () => {
  const a = { type: 'count', expected: 28, tolerance: 0 };
  assert.equal(judgeAnswer(a, 'Found 28 transaction(s) (Dining), ₹560.50 spent:', '₹').correct, true);
  assert.equal(judgeAnswer(a, 'Found 20 transaction(s) … and 8 more charges', '₹').correct, false);
  assert.equal(judgeAnswer(a, '₹28.00 across 7 charges', '₹').correct, false);
  assert.equal(judgeAnswer(a, 'twenty-eight', '₹').correct, false);
});

test('abstain answers', () => {
  const a = { type: 'abstain' };
  assert.equal(judgeAnswer(a, "I couldn't find any transactions matching that.", '₹').correct, true);
  assert.equal(judgeAnswer(a, 'You spent ₹2,140.00 in Sep 2026.', '₹').correct, false);
});

test('floor4 never rounds up', () => {
  assert.equal(floor4(2 / 3), 0.6666);
  assert.equal(floor4(0.57), 0.57);
  assert.equal(floor4(0.99999), 0.9999);
  assert.equal(floor4(1), 1);
});
