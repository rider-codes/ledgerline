'use strict';
// node --experimental-sqlite --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, DEFAULT_MONTH } = require('./helpers');
const { retrieve, parseFilters, searchAnswer, formatForPrompt } = require('../src/retrieve');

const lex = (q, extra = {}) => retrieve(USER, q, { mode: 'lexical', k: 20, defaultMonth: DEFAULT_MONTH, ...extra });

// ---- bug 1: counts and totals cover every match, not just the rows returned ----

test('structured query: matched count and total are the full SQL figures', async () => {
  const r = await lex('groceries charges in june', { k: 5 });
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.matched, { count: 30, spend: 300, income: 0 });
  assert.equal(r.truncated, true);
});

test('search answer and prompt block report the full count and total', async () => {
  const text = await searchAnswer(USER, 'list groceries charges in june', { mode: 'lexical', defaultMonth: DEFAULT_MONTH });
  assert.match(text, /^Found 30 transaction\(s\) \(Groceries, 2026-06\), ₹300\.00 spent:/);
  assert.match(text, /…and 18 more\./);
  const block = formatForPrompt(await lex('groceries charges in june', { k: 5 }));
  assert.match(block, /30 matched, the 5 most relevant listed, ₹300\.00 spent in total/);
  assert.match(block, /25 more matches not listed/);
});

test('free-text query: matched covers every qualifying row', async () => {
  const r = await lex('corner store in june', { k: 5 });
  assert.equal(r.mode, 'lexical');
  assert.equal(r.rows.length, 5);
  assert.equal(r.matched.count, 30);
  assert.equal(r.matched.spend, 300);
});

test('nothing matched', async () => {
  const r = await lex('zzzznotamerchant');
  assert.equal(r.rows.length, 0);
  assert.equal(r.matched.count, 0);
  assert.equal(await searchAnswer(USER, 'show me zzzznotamerchant', { mode: 'lexical' }), "I couldn't find any transactions matching that.");
});

module.exports = { lex, parseFilters };

// ---- bug 2: month names only match as whole words ----

test('month names inside other words are not months', () => {
  const pf = (q) => parseFilters(q, DEFAULT_MONTH, USER);
  assert.equal(pf('show me doctor visits').month, undefined);
  assert.equal(pf('what did I spend at the supermarket').month, undefined);
  assert.equal(pf('home decor purchases').month, undefined);
  assert.equal(pf('marching band fees').month, undefined);
});

test('real month mentions still resolve', () => {
  const pf = (q) => parseFilters(q, DEFAULT_MONTH, USER);
  assert.equal(pf('dining in august').month, '2026-08');
  assert.equal(pf('dining in aug').month, '2026-08');
  assert.equal(pf('groceries in october').month, '2025-10');
  assert.equal(pf('transport in sept').month, '2026-09');
  assert.equal(pf('doctor visits in august').month, '2026-08');
});

test('a merchant containing "doctor" is found without a month filter', async () => {
  const r = await lex('doctor clinic in august');
  assert.deepEqual(r.rows.map((x) => x.merchant), ['City Doctor Clinic']);
});
