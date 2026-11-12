'use strict';
// node --experimental-sqlite --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, USER } = require('./helpers');
const demo = require('../src/demo');
const { login, publicUser } = require('../src/auth');

const count = (sql, ...args) => db.prepare(sql).get(...args).c;
const clean = () => db.exec(`DELETE FROM users WHERE email LIKE 'demo-%@${demo.DOMAIN}'`);

test('DEMO_MODE is off unless set to "true"', () => {
  const before = process.env.DEMO_MODE;
  delete process.env.DEMO_MODE;
  assert.equal(demo.enabled(), false);
  process.env.DEMO_MODE = 'true';
  assert.equal(demo.enabled(), true);
  process.env.DEMO_MODE = 'yes';
  assert.equal(demo.enabled(), false);
  if (before === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = before;
});

test('DEMO_ONLY is off by default, and turning it on also turns the demo on', () => {
  const saved = { mode: process.env.DEMO_MODE, only: process.env.DEMO_ONLY };
  try {
    delete process.env.DEMO_MODE; delete process.env.DEMO_ONLY;
    assert.equal(demo.only(), false);
    assert.equal(demo.enabled(), false);
    process.env.DEMO_ONLY = 'true';
    assert.equal(demo.only(), true);
    assert.equal(demo.enabled(), true, 'DEMO_ONLY implies DEMO_MODE');
    process.env.DEMO_ONLY = 'false'; process.env.DEMO_MODE = 'true';
    assert.equal(demo.only(), false);
    assert.equal(demo.enabled(), true);
  } finally {
    for (const [k, v] of [['DEMO_MODE', saved.mode], ['DEMO_ONLY', saved.only]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('a sandbox gets the full sample dataset and leaves other users untouched', () => {
  clean();
  const mine = count('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?', USER);
  const u = demo.createDemoUser();
  assert.match(u.email, /^demo-[0-9a-f]{12}@demo\.ledgerline\.test$/);
  assert.ok(count('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?', u.id) >= 200);
  assert.equal(count('SELECT COUNT(*) AS c FROM rules WHERE user_id = ?', u.id), 5);
  assert.equal(count('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?', USER), mine);
  assert.equal(publicUser({ id: u.id, email: u.email, name: u.name }).demo, true);
  assert.equal(publicUser({ id: 1, email: 'test@example.com', name: 'T' }).demo, false);
  clean();
});

test('the sample data spans more than a year, and the original May-Sep 2026 block is unchanged', () => {
  clean();
  const u = demo.createDemoUser();
  const q = (sql) => db.prepare(sql).get(u.id);
  assert.ok(q("SELECT COUNT(DISTINCT substr(date,1,7)) AS c FROM transactions WHERE user_id = ?").c >= 13);
  assert.equal(q("SELECT COUNT(DISTINCT substr(date,1,4)) AS c FROM transactions WHERE user_id = ?").c, 2);
  assert.ok(q("SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?").c > 700);
  // the earlier block is generated separately, so the original months keep their exact numbers
  assert.equal(q("SELECT ROUND(SUM(amount),2) AS c FROM transactions WHERE user_id = ? AND type='expense' AND date >= '2026-05-01'").c, 17275.86);
  assert.equal(q("SELECT ROUND(SUM(amount),2) AS c FROM transactions WHERE user_id = ? AND type='expense' AND substr(date,1,7) = '2026-08'").c, 3908.21);
  clean();
});

test('seedUserData({ legacy: true }) gives only the original 271 rows', () => {
  clean();
  const id = Number(db.prepare("INSERT INTO users (email, password_hash, name) VALUES (?, '!x', 'Legacy')").run(`demo-legacy01@${demo.DOMAIN}`).lastInsertRowid);
  const r = require('../src/seed').seedUserData(id, { legacy: true });
  assert.equal(r.count, 271);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get(id).c, 271);
  assert.equal(db.prepare("SELECT MIN(date) AS d FROM transactions WHERE user_id = ?").get(id).d, '2026-05-01');
  clean();
});

test('every visitor gets their own account with identical data', () => {
  clean();
  const a = demo.createDemoUser();
  const b = demo.createDemoUser();
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.email, b.email);
  const sum = (id) => db.prepare("SELECT ROUND(SUM(amount),2) AS s, COUNT(*) AS c FROM transactions WHERE user_id = ?").get(id);
  assert.deepEqual({ ...sum(a.id) }, { ...sum(b.id) });
  clean();
});

test('nobody can sign in to a sandbox account', () => {
  clean();
  const u = demo.createDemoUser();
  for (const pw of ['', 'demo1234', 'password', '!demo-account-no-password']) {
    assert.throws(() => login({ email: u.email, password: pw }), { status: 401 });
  }
  clean();
});

test('expired sandboxes are swept, with their data; real users are kept', () => {
  clean();
  const old = demo.createDemoUser();
  const fresh = demo.createDemoUser();
  db.prepare("UPDATE users SET created_at = datetime('now', '-2 days') WHERE id = ?").run(old.id);
  assert.equal(demo.sweepExpired(), 1);
  assert.equal(count('SELECT COUNT(*) AS c FROM users WHERE id = ?', old.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?', old.id), 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM rules WHERE user_id = ?', old.id), 0);
  assert.ok(count('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?', fresh.id) > 0);
  assert.equal(count('SELECT COUNT(*) AS c FROM users WHERE id = ?', USER), 1);
  clean();
});

test('the number of live sandboxes is capped', () => {
  clean();
  const before = process.env.DEMO_MAX_ACTIVE;
  process.env.DEMO_MAX_ACTIVE = '2';
  demo.createDemoUser();
  demo.createDemoUser();
  assert.throws(() => demo.createDemoUser(), { status: 503 });
  assert.equal(demo.activeCount(), 2);
  if (before === undefined) delete process.env.DEMO_MAX_ACTIVE; else process.env.DEMO_MAX_ACTIVE = before;
  clean();
});
