'use strict';

const express = require('express');
const { signup, login, loadUser } = require('../auth');
const { rateLimit } = require('../ratelimit');
const demo = require('../demo');

const router = express.Router();

// per (IP + email): 8 tries / 15 min. A wide per-IP net also caps spraying.
const emailFrom = (req) => (req.body && req.body.email) || '';
const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: 8, keyFrom: emailFrom, message: 'Too many sign-in attempts. Wait a few minutes and try again.' });
const signupLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, keyFrom: emailFrom, message: 'Too many sign-up attempts from this device. Try again later.' });
const ipSprayLimit = rateLimit({ windowMs: 15 * 60_000, max: 40, message: 'Too many attempts from this device. Try again later.' });

// DEMO_ONLY sites have no real accounts: refuse sign-up and sign-in at the API, not just in the UI
const noAccounts = (req, res, next) =>
  demo.only()
    ? res.status(403).json({ error: 'Accounts are turned off on this demo. Use "Explore with sample data", or copy the project to run your own.' })
    : next();

router.post('/signup', noAccounts, ipSprayLimit, signupLimit, (req, res) => {
  try {
    const user = signup(req.body || {});
    req.session.userId = user.id;
    res.json({ user });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

router.post('/login', noAccounts, ipSprayLimit, loginLimit, (req, res) => {
  try {
    const user = login(req.body || {});
    req.session.userId = user.id;
    loginLimit.reset(req, res); // clear the counter on success
    res.json({ user });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

// One-click demo: a private sandbox account with sample data (DEMO_MODE=true only).
// 5 per hour per IP; the account cap and expiry live in src/demo.js.
const demoLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, message: 'Too many demo sessions from this device. Try again later.' });
router.post('/demo', ipSprayLimit, demoLimit, (req, res) => {
  if (!demo.enabled()) return res.status(404).json({ error: 'Unknown endpoint.' });
  try {
    const user = demo.createDemoUser();
    req.session.userId = user.id;
    res.json({ user: { ...user, demo: true } });
  } catch (e) {
    if (!e.status) console.error('demo error:', e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = loadUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user });
});

module.exports = router;
