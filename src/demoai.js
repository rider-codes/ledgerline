'use strict';

// A cloud-model assistant for demo sandboxes (DEMO_MODE).
//
// The API key lives only in the server's environment (DEMO_ANTHROPIC_API_KEY). It is never sent to
// a browser, logged, or stored. Cost is bounded three ways:
//   - each sandbox gets DEMO_AI_DAILY_LIMIT questions (default 15);
//   - the whole site gets DEMO_AI_GLOBAL_DAILY questions per UTC day (default 300);
//   - answers use a small model with a short output cap and no extended thinking.
// When the key is missing or a budget is used up, the sandbox falls back to the built-in rules
// assistant, so the demo never breaks. Set a spend limit on the API account as well.

const { db } = require('./db');

const int = (v, dflt, min = 0) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.max(min, Math.floor(Number(v))) : dflt);
const apiKey = () => String(process.env.DEMO_ANTHROPIC_API_KEY || '').trim();
const enabled = () => apiKey().length > 0;
const model = () => process.env.DEMO_ANTHROPIC_MODEL || 'claude-haiku-5-5';
const perUserLimit = () => int(process.env.DEMO_AI_DAILY_LIMIT, 15);
const globalLimit = () => int(process.env.DEMO_AI_GLOBAL_DAILY, 300);
const maxTokens = () => int(process.env.DEMO_AI_MAX_TOKENS, 600, 50);
const today = () => new Date().toISOString().slice(0, 10);
const userScope = (id) => `user:${id}`;

function used(scope) {
  const row = db.prepare('SELECT count FROM ai_usage WHERE scope = ? AND day = ?').get(scope, today());
  return row ? row.count : 0;
}
const bump = (scope, by) =>
  db
    .prepare(
      `INSERT INTO ai_usage (scope, day, count) VALUES (?, ?, MAX(0, ?))
       ON CONFLICT(scope, day) DO UPDATE SET count = MAX(0, count + ?)`
    )
    .run(scope, today(), by, by);

// What a sandbox may still do today (does not use any of it up).
function status(userId) {
  const limit = perUserLimit();
  const left = Math.max(0, limit - used(userScope(userId)));
  const globalLeft = Math.max(0, globalLimit() - used('global'));
  return { enabled: enabled(), model: model(), limit, remaining: Math.min(left, globalLeft), globalExhausted: globalLeft === 0 };
}

// Use up one question. { ok: true, remaining } or { ok: false, reason: 'off' | 'user' | 'global' }.
function take(userId) {
  if (!enabled()) return { ok: false, reason: 'off' };
  const limit = perUserLimit();
  if (used(userScope(userId)) >= limit) return { ok: false, reason: 'user' };
  if (used('global') >= globalLimit()) return { ok: false, reason: 'global' };
  bump(userScope(userId), 1);
  bump('global', 1);
  db.prepare("DELETE FROM ai_usage WHERE day < date('now', '-3 days')").run(); // tiny table; keep a few days
  return { ok: true, remaining: Math.max(0, limit - used(userScope(userId))) };
}

// Give a question back (the cloud call failed and the built-in assistant answered instead).
function refund(userId) {
  bump(userScope(userId), -1);
  bump('global', -1);
}

// Per-call overrides for agent.js's Claude backend.
const overrides = () => ({ apiKey: apiKey(), model: model(), maxTokens: maxTokens(), thinking: false });

module.exports = { enabled, status, take, refund, overrides, perUserLimit, globalLimit };
