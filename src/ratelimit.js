'use strict';

/*
 * Tiny in-memory fixed-window rate limiter. Single-process only (state resets on
 * restart), which is fine for a local-first app — it exists to blunt password
 * brute-force and signup spam, not to be a distributed quota system.
 */

function createLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> { count, resetAt }

  function check(key) {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now >= e.resetAt) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(key, e);
    }
    e.count += 1;
    const allowed = e.count <= max;
    return { allowed, retryAfter: allowed ? 0 : Math.ceil((e.resetAt - now) / 1000) };
  }

  function reset(key) {
    hits.delete(key);
  }

  // opportunistic cleanup so the map can't grow unbounded
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of hits) if (now >= e.resetAt) hits.delete(k);
  }, windowMs).unref?.();

  return { check, reset };
}

// Express middleware: limit by `${req.ip}:${keyFrom(req)}`. On block -> 429.
function rateLimit({ windowMs, max, keyFrom = () => '', message = 'Too many attempts. Try again later.' }) {
  const limiter = createLimiter({ windowMs, max });
  const mw = (req, res, next) => {
    const key = `${req.ip}:${String(keyFrom(req) || '').toLowerCase()}`;
    const { allowed, retryAfter } = limiter.check(key);
    if (!allowed) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message });
    }
    res.locals.rlKey = key;
    res.locals.rlReset = () => limiter.reset(key);
    next();
  };
  mw.reset = (req, res) => res.locals.rlReset && res.locals.rlReset();
  return mw;
}

module.exports = { createLimiter, rateLimit };
