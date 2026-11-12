'use strict';

require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');

const { requireAuth, loadUser } = require('./src/auth');
const { SESSION_SECRET_FILE } = require('./src/paths');

const app = express();
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

// Resolve a real session secret. If SESSION_SECRET is unset or still a placeholder,
// generate a strong one and persist it under DATA_DIR so sessions survive restarts —
// never fall back to a shared, guessable default.
function resolveSessionSecret() {
  const raw = String(process.env.SESSION_SECRET || '').trim();
  const isPlaceholder = !raw || /^(change[- ]?me|dev[- ]?secret|your[- ]?secret|secret|xxx+)/i.test(raw) || raw.length < 16;
  if (!isPlaceholder) return raw;

  const file = SESSION_SECRET_FILE;
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* not created yet */ }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
    console.warn(`[ledgerline] SESSION_SECRET not set — generated one at ${file}. Set SESSION_SECRET to use your own.`);
  } catch (e) {
    console.warn(`[ledgerline] SESSION_SECRET not set and could not persist a generated one (${e.message}); using an in-memory secret (sessions reset on restart).`);
  }
  return generated;
}

const SESSION_SECRET = resolveSessionSecret();

app.disable('x-powered-by');
// Behind a hosting proxy (Render, Railway) TLS ends at the proxy; trust its X-Forwarded-* headers
// so req.secure / req.ip are right — needed for secure cookies and per-IP rate limiting.
// TRUST_PROXY is a hop count (0 disables); empty means the default: 1 in production, off otherwise.
const trustProxy = process.env.TRUST_PROXY || (PROD ? '1' : '');
if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(
  cookieSession({
    name: 'ledgerline.sid',
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: 'lax',
    secure: PROD, // HTTPS-only cookie in production
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
);

// health check — unauthenticated, for readiness probes / uptime monitors
app.get('/healthz', (req, res) => res.type('text').send('ok'));

// runtime config for the frontend (currency symbol) — a blocking script loaded before shell.js
app.get('/assets/config.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  res.send(`window.__CURRENCY__ = ${JSON.stringify(process.env.CURRENCY || '$')};`);
});

// static assets (css/js) — never the HTML pages
app.use(
  '/assets',
  express.static(path.join(PUBLIC, 'assets'), {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

// ---- API: auth (open) ----
app.use('/api', require('./src/routes/auth'));

// ---- API: everything else (auth required) ----
app.use('/api', requireAuth);
app.use('/api', require('./src/routes/analytics'));
app.use('/api', require('./src/routes/transactions'));
app.use('/api', require('./src/routes/rules'));
app.use('/api', require('./src/routes/embed'));
app.use('/api', require('./src/routes/chat'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));

// ---- pages ----
app.get(['/login', '/signup'], (req, res) => {
  if (loadUser(req)) return res.redirect('/');
  res.sendFile(path.join(PUBLIC, req.path === '/signup' ? 'signup.html' : 'login.html'));
});

const PAGES = {
  '/': 'index.html',
  '/transactions': 'transactions.html',
  '/rules': 'rules.html',
  '/reports': 'reports.html',
  '/assistant': 'assistant.html',
  '/import': 'import.html',
};
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, requireAuth, (req, res) => res.sendFile(path.join(PUBLIC, file)));
}

app.use((req, res) => res.redirect('/'));

// ---- error handler ----
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Only echo messages for deliberate 4xx errors; 5xx stay generic (no internals to the client).
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status < 500 ? err.message : 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Ledgerline running at http://localhost:${PORT}`);
  console.log(`AI backend: ${(process.env.AI_BACKEND || 'rules')}`);
});
