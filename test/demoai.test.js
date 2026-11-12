'use strict';
// node --experimental-sqlite --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers');
const ai = require('../src/demoai');

const KEY = 'sk-ant-test-0000000000000000';
const ENV = ['DEMO_ANTHROPIC_API_KEY', 'DEMO_ANTHROPIC_MODEL', 'DEMO_AI_DAILY_LIMIT', 'DEMO_AI_GLOBAL_DAILY', 'DEMO_AI_MAX_TOKENS'];

function withEnv(vars, fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  ENV.forEach((k) => delete process.env[k]);
  Object.assign(process.env, vars);
  db.exec('DELETE FROM ai_usage');
  try { return fn(); } finally {
    ENV.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    db.exec('DELETE FROM ai_usage');
  }
}

test('off without a key: nothing is used up and nothing is charged', () => {
  withEnv({}, () => {
    assert.equal(ai.enabled(), false);
    assert.deepEqual(ai.take(5), { ok: false, reason: 'off' });
    assert.equal(ai.status(5).enabled, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ai_usage').get().c, 0);
  });
});

test('each sandbox gets its own daily budget', () => {
  withEnv({ DEMO_ANTHROPIC_API_KEY: KEY, DEMO_AI_DAILY_LIMIT: '3' }, () => {
    assert.equal(ai.status(1).remaining, 3);
    assert.deepEqual(ai.take(1), { ok: true, remaining: 2 });
    assert.deepEqual(ai.take(1), { ok: true, remaining: 1 });
    assert.deepEqual(ai.take(1), { ok: true, remaining: 0 });
    assert.deepEqual(ai.take(1), { ok: false, reason: 'user' });
    assert.equal(ai.status(1).remaining, 0);
    assert.equal(ai.take(2).ok, true, 'another sandbox is unaffected');
  });
});

test('a site-wide daily cap stops everyone, whatever their own budget', () => {
  withEnv({ DEMO_ANTHROPIC_API_KEY: KEY, DEMO_AI_DAILY_LIMIT: '10', DEMO_AI_GLOBAL_DAILY: '2' }, () => {
    assert.equal(ai.take(1).ok, true);
    assert.equal(ai.take(2).ok, true);
    assert.deepEqual(ai.take(3), { ok: false, reason: 'global' });
    assert.equal(ai.status(3).remaining, 0);
    assert.equal(ai.status(3).globalExhausted, true);
  });
});

test('a refunded question goes back to both budgets, and never below zero', () => {
  withEnv({ DEMO_ANTHROPIC_API_KEY: KEY, DEMO_AI_DAILY_LIMIT: '2' }, () => {
    ai.take(1);
    assert.equal(ai.status(1).remaining, 1);
    ai.refund(1);
    assert.equal(ai.status(1).remaining, 2);
    ai.refund(1);
    ai.refund(1);
    assert.equal(ai.status(1).remaining, 2, 'extra refunds do not create budget');
    assert.equal(db.prepare("SELECT count FROM ai_usage WHERE scope = 'global'").get().count, 0);
  });
});

test('old days are cleaned up and do not count against today', () => {
  withEnv({ DEMO_ANTHROPIC_API_KEY: KEY, DEMO_AI_DAILY_LIMIT: '1' }, () => {
    db.prepare("INSERT INTO ai_usage (scope, day, count) VALUES ('user:1', date('now','-10 days'), 99), ('global', date('now','-10 days'), 99)").run();
    assert.equal(ai.take(1).ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM ai_usage WHERE day < date('now','-3 days')").get().c, 0);
  });
});

test('the key never appears in what the browser can see', () => {
  withEnv({ DEMO_ANTHROPIC_API_KEY: KEY }, () => {
    const seen = JSON.stringify(ai.status(1));
    assert.ok(!seen.includes(KEY) && !seen.includes('sk-ant'));
    const o = ai.overrides();
    assert.equal(o.apiKey, KEY); // only the server-side call gets it
    assert.equal(o.model, 'claude-haiku-5-5');
    assert.equal(o.thinking, false);
    assert.equal(o.maxTokens, 600);
  });
});

test('limits fall back to safe defaults on bad input', () => {
  withEnv({ DEMO_ANTHROPIC_API_KEY: KEY, DEMO_AI_DAILY_LIMIT: 'lots', DEMO_AI_MAX_TOKENS: '5' }, () => {
    assert.equal(ai.perUserLimit(), 15);
    assert.equal(ai.overrides().maxTokens, 50, 'never so small the answer is cut to nothing');
  });
});
