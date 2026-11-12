'use strict';

// One-click demo: every visitor gets a private sandbox account filled with the sample dataset,
// so they can import, edit and ask the assistant without seeing or changing anyone else's data.
// Sandbox accounts have an unusable password (nobody can sign in to them again), live for
// DEMO_TTL_HOURS, and are swept on the next demo start. Off unless DEMO_MODE=true.

const crypto = require('node:crypto');
const { db } = require('./db');
const { seedUserData } = require('./seed');

const DOMAIN = 'demo.ledgerline.test'; // .test is reserved, so it can never collide with a real address
const EMAIL_SQL = `demo-%@${DOMAIN}`;

const enabled = () => String(process.env.DEMO_MODE || '').toLowerCase() === 'true';
const ttlHours = () => Math.max(1, Number(process.env.DEMO_TTL_HOURS) || 24);
const maxActive = () => Math.max(1, Number(process.env.DEMO_MAX_ACTIVE) || 100);
const isDemoEmail = (email) => String(email || '').toLowerCase().endsWith(`@${DOMAIN}`);

// Delete sandboxes older than the TTL. Foreign keys cascade to transactions, rules, the
// classifier model and embeddings.
function sweepExpired() {
  const modifier = `-${ttlHours()} hours`;
  return Number(
    db.prepare(`DELETE FROM users WHERE email LIKE ? AND created_at < datetime('now', ?)`).run(EMAIL_SQL, modifier).changes
  );
}

function activeCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM users WHERE email LIKE ?').get(EMAIL_SQL).c;
}

function createDemoUser() {
  sweepExpired();
  if (activeCount() >= maxActive()) {
    const e = new Error('The demo is busy right now. Please try again in a little while.');
    e.status = 503;
    throw e;
  }
  const email = `demo-${crypto.randomBytes(6).toString('hex')}@${DOMAIN}`;
  // Not a valid bcrypt hash, so bcrypt.compare() can never succeed for this account.
  const hash = '!demo-account-no-password';
  db.exec('BEGIN');
  try {
    const info = db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run(email, hash, 'Demo visitor');
    const id = Number(info.lastInsertRowid);
    seedUserData(id);
    db.exec('COMMIT');
    return { id, email, name: 'Demo visitor' };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { enabled, isDemoEmail, createDemoUser, sweepExpired, activeCount, ttlHours, DOMAIN };
