'use strict';
// node --experimental-sqlite --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER, DEFAULT_MONTH } = require('./helpers');
const A = require('../src/analytics');
const { ask } = require('../src/agent');

A.pinDefaultMonth(USER, DEFAULT_MONTH);
const reply = async (q) => (await ask(USER, q)).reply;

// ---- bug 8: intent handlers respect the category / merchant the question names ----

test('"biggest dining purchase" is narrowed to Dining', async () => {
  const r = await reply('biggest dining purchase in august');
  assert.match(r, /^Biggest Dining expenses in Aug 2026:\n1\. ₹120\.00 — Nobu/);
  assert.doesNotMatch(r, /Best Buy/);
});

test('"biggest purchase" without a category still covers everything', async () => {
  assert.match(await reply('biggest purchase in august'), /^Biggest expenses in Aug 2026:\n1\. ₹600\.00 — Best Buy/);
});

test('"biggest" narrowed to a merchant', async () => {
  assert.match(await reply('biggest chipotle purchase in august'), /^Biggest Chipotle expenses in Aug 2026:\n1\. ₹45\.00 — Chipotle/);
});

test('a brand with no transactions is not answered with its whole category', async () => {
  assert.equal(await reply('how much at uber'), "I don't see any transactions at Uber.");
  assert.equal(await reply('how much did I spend at tesla in august?'), "I don't see any transactions at Tesla.");
  assert.equal(await reply('biggest purchase at tesla'), "I don't see any transactions at Tesla.");
});

test('a known merchant is still answered', async () => {
  assert.match(await reply('how much at chipotle'), /^Chipotle \(Dining\): ₹75\.00 total across 2 charges/);
});

// ---- "spend on <topic>" that is not one category or merchant goes to search, not the monthly total ----

test('a multi-part topic is searched, not answered with the monthly total', async () => {
  const { reply: r, trace } = await ask(USER, 'how much did I spend on chipotle and nobu?');
  assert.equal(trace.route, 'search');
  assert.match(r, /^Found \d+ transaction/);
  assert.match(r, /Chipotle/);
  assert.match(r, /Nobu/);
});

test('a single category topic still uses the category handler', async () => {
  assert.match(await reply('how much did I spend on dining in august'), /^Dining in Aug 2026/);
});

test('a topic that is all one category uses the category handler', async () => {
  assert.match(await reply('how much did I spend on lunch and dinner in august'), /^Dining in Aug 2026/);
});

test('"spend on everything" is still the monthly total', async () => {
  assert.match(await reply('how much did I spend on everything in august'), /^You spent /);
});

test('"at least" / "at the supermarket" are not unknown merchants', async () => {
  assert.doesNotMatch(await reply('how much did I spend at least'), /don't see any transactions at/);
  // the test data has a "Supermarket Fresh" merchant, so this resolves to it
  assert.match(await reply('how much did I spend at the supermarket'), /^Supermarket Fresh \(Groceries\)/);
});
