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

// ---- bug 3: amount filters accept currency symbols other than $ ----

test('amount filters understand ₹, rs, inr and $', () => {
  const pf = (q) => parseFilters(q, DEFAULT_MONTH, USER);
  assert.equal(pf('transactions over ₹500').minAmount, 500);
  assert.equal(pf('transactions over $500').minAmount, 500);
  assert.equal(pf('charges under rs 20').maxAmount, 20);
  assert.equal(pf('charges under Rs. 1,200.50').maxAmount, 1200.5);
  assert.equal(pf('charges over INR 100').minAmount, 100);
  assert.equal(pf('charges over 100').minAmount, 100);
  const b = pf('between ₹40 and ₹60');
  assert.deepEqual([b.minAmount, b.maxAmount], [40, 60]);
});

test('a ₹ amount filter narrows results and leaves no stray search word', async () => {
  const r = await lex('charges over ₹500 in august');
  assert.equal(r.mode, 'structured');
  assert.deepEqual(r.rows.map((x) => x.merchant), ['Best Buy']);
  assert.equal((await lex('charges over inr 500 in august')).mode, 'structured');
  assert.equal((await lex('charges over 500 rupees in august')).mode, 'structured');
});

// ---- bug 4: punctuation next to a category word does not hide it ----

test('categories are detected next to punctuation', () => {
  const pf = (q) => parseFilters(q, DEFAULT_MONTH, USER);
  assert.equal(pf('how much on dining?').category, 'Dining');
  assert.equal(pf('how much on dining').category, 'Dining');
  assert.equal(pf('Dining, in august.').category, 'Dining');
  assert.equal(pf('what about (shopping)?').category, 'Shopping');
  assert.equal(pf('any restaurants?').category, 'Dining');
  assert.equal(pf('take-out?').category, 'Dining');
  assert.equal(pf('how much at chipotle?').category, undefined);
});

test('"dining?" filters to the category', async () => {
  const r = await lex('how much on dining in august?');
  assert.equal(r.mode, 'structured');
  assert.equal(r.matched.count, 3);
});

// ---- bug 5: "of/for <number>" is only an amount when it is written as money ----

test('durations and bare numbers after of/for are not amounts', () => {
  const pf = (q) => parseFilters(q, DEFAULT_MONTH, USER);
  const none = (q) => assert.deepEqual([pf(q).minAmount, pf(q).maxAmount], [undefined, undefined], q);
  none('list charges for 2026');
  none('dining for 3 months');
  none('spending over 2 weeks');
  none('about 3 months of dining');
  none('top 5 charges of 2026');
  const mixed = pf('charges over 100 for 3 months');
  assert.deepEqual([mixed.minAmount, mixed.maxAmount], [100, undefined]);
});

test('money after of/for and explicit cues still filter', () => {
  const pf = (q) => parseFilters(q, DEFAULT_MONTH, USER);
  const win = (q) => [pf(q).minAmount, pf(q).maxAmount];
  assert.deepEqual(win('a charge of ₹45'), [44.5, 45.5]);
  assert.deepEqual(win('a charge for 12.50'), [12, 13]);
  assert.deepEqual(win('exactly 120'), [119.5, 120.5]);
  assert.deepEqual(win('around 600'), [599.5, 600.5]);
  assert.deepEqual(win('over 1,000'), [1000, undefined]);
  assert.deepEqual(win('under 20.'), [undefined, 20]);
  assert.deepEqual(win('between 40 and 60'), [40, 60]);
  assert.deepEqual(win('at least 50 and at most 200'), [50, 200]);
});

test('"charges over 100 for 3 months" keeps the 100 filter', async () => {
  const r = await lex('dining charges over 100 for 3 months');
  assert.deepEqual(r.rows.map((x) => x.merchant), ['Nobu']);
});

// ---- bug 6: old transactions are searched too (no newest-800 window) ----

test('a merchant older than the newest 800 rows is still found', async () => {
  const r = await lex('old bookshop');
  // ranked first; 'Old Diner' also matches the word "old" and may follow
  assert.deepEqual([r.rows[0].merchant, r.rows[0].date], ['Old Bookshop', '2020-01-15']);
  assert.equal(r.truncatedCandidates, false);
});

test('free-text totals cover the whole account', async () => {
  const r = await lex('corner store', { k: 5 });
  assert.equal(r.matched.count, 30);
  assert.equal(r.candidateCount, r.matchCount);
});
