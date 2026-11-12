'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('./db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const DEMO_EMAIL_RE = /@demo\.ledgerline\.test$/i; // sandbox accounts from src/demo.js

function publicUser(row) {
  return row
    ? { id: row.id, email: row.email, name: row.name || row.email.split('@')[0], demo: DEMO_EMAIL_RE.test(row.email) }
    : null;
}

function signup({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim();
  if (!EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email address.');
  if (String(password || '').length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) throw httpError(409, 'An account with that email already exists.');
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
    .run(email, hash, name || null);
  return publicUser({ id: Number(info.lastInsertRowid), email, name });
}

function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !bcrypt.compareSync(String(password || ''), row.password_hash)) {
    throw httpError(401, 'Email or password is incorrect.');
  }
  return publicUser(row);
}

function loadUser(req) {
  const id = req.session && req.session.userId;
  if (!id) return null;
  const row = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(id);
  return publicUser(row);
}

function requireAuth(req, res, next) {
  const user = loadUser(req);
  if (!user) {
    // req.path is mount-relative inside app.use('/api', ...); use originalUrl.
    if ((req.originalUrl || req.url).startsWith('/api/')) return res.status(401).json({ error: 'Not signed in.' });
    return res.redirect('/login');
  }
  req.user = user;
  next();
}

module.exports = { signup, login, loadUser, requireAuth, publicUser };
