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

test('"at least" / "at the supermarket" are not unknown merchants', async () => {
  assert.doesNotMatch(await reply('how much did I spend at least'), /don't see any transactions at/);
  // the test data has a "Supermarket Fresh" merchant, so this resolves to it
  assert.match(await reply('how much did I spend at the supermarket'), /^Supermarket Fresh \(Groceries\)/);
});
