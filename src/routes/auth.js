'use strict';

const express = require('express');
const { signup, login, loadUser } = require('../auth');
const { rateLimit } = require('../ratelimit');

const router = express.Router();

// per (IP + email): 8 tries / 15 min. A wide per-IP net also caps spraying.
const emailFrom = (req) => (req.body && req.body.email) || '';
const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: 8, keyFrom: emailFrom, message: 'Too many sign-in attempts. Wait a few minutes and try again.' });
const signupLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, keyFrom: emailFrom, message: 'Too many sign-up attempts from this device. Try again later.' });
const ipSprayLimit = rateLimit({ windowMs: 15 * 60_000, max: 40, message: 'Too many attempts from this device. Try again later.' });

router.post('/signup', ipSprayLimit, signupLimit, (req, res) => {
  try {
    const user = signup(req.body || {});
    req.session.userId = user.id;
    res.json({ user });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

router.post('/login', ipSprayLimit, loginLimit, (req, res) => {
  try {
    const user = login(req.body || {});
    req.session.userId = user.id;
    loginLimit.reset(req, res); // clear the counter on success
    res.json({ user });
  } catch (e) {
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
