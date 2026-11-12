'use strict';

const express = require('express');
const { askStream } = require('../agent');
const demoAi = require('../demoai');

const router = express.Router();

// Which engine answers for this user. Demo sandboxes never use the owner's AI_BACKEND: they get the
// cloud model while the demo key is set and their daily budget lasts, otherwise the built-in rules.
function engineFor(req) {
  if (!(req.user && req.user.demo)) {
    const backend = (process.env.AI_BACKEND || 'rules').toLowerCase();
    return { backend, model: backend === 'ollama' ? process.env.OLLAMA_MODEL || 'llama3.1:8b' : backend === 'anthropic' ? process.env.ANTHROPIC_MODEL || 'claude-sonnet-5' : 'built-in analysis' };
  }
  const s = demoAi.status(req.user.id);
  if (s.enabled && s.remaining > 0) return { backend: 'anthropic', model: s.model, demo: { limit: s.limit, remaining: s.remaining } };
  return { backend: 'rules', model: 'built-in analysis', demo: s.enabled ? { limit: s.limit, remaining: 0 } : null };
}

router.get('/chat/config', (req, res) => {
  const e = engineFor(req);
  res.json({
    backend: e.backend,
    model: e.model,
    hasKey: req.user && req.user.demo ? demoAi.enabled() : !!process.env.ANTHROPIC_API_KEY, // never the key itself
    demo: e.demo || null,
  });
});

const clip = (s, n) => String(s || '').slice(0, n);

// Server-Sent Events. Frames: {type:'meta'|'delta'|'note'|'done'|'error', ...}
router.post('/chat', async (req, res) => {
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  const isDemo = !!(req.user && req.user.demo);
  if (isDemo && message.length > 500) return res.status(400).json({ error: 'Keep demo questions under 500 characters.' });
  let history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];
  if (isDemo) history = history.map((m) => ({ role: m && m.role, content: clip(m && m.content, 1500) }));

  // Demo sandboxes: use up one cloud question now (given back below if the cloud call fails)
  let demoTurn = null;
  if (isDemo) demoTurn = demoAi.take(req.user.id);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();

  let sentNote = false;
  const send = (obj) => {
    if (obj && obj.type === 'note') {
      sentNote = true;
      // agent.js notes carry the provider's raw error text; visitors only need to know it fell back
      if (isDemo) obj = { type: 'note', text: 'The AI is unavailable right now, so this answer is from the built-in assistant.' };
    }
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, 15000);
  const abort = new AbortController();
  // res 'close' fires on client disconnect (or after we finish). Only the former should abort.
  res.on('close', () => { if (!res.writableEnded) abort.abort(); clearInterval(heartbeat); });

  try {
    const opts = { abortSignal: abort.signal };
    const trace = {};
    if (isDemo) {
      Object.assign(opts, { trace }, demoTurn.ok ? { backend: 'anthropic', anthropic: demoAi.overrides() } : { backend: 'rules' });
    } else {
      opts.backend = engineFor(req).backend;
    }
    await askStream(req.user.id, message, history, send, opts);

    if (isDemo) {
      const cloudFailed = demoTurn.ok && trace.fallbackFrom;
      if (cloudFailed) demoAi.refund(req.user.id); // the built-in assistant answered; don't charge the visitor's budget
      if (!sentNote) {
        const s = demoAi.status(req.user.id);
        if (demoTurn.ok && !cloudFailed) send({ type: 'note', text: `AI answer. ${s.remaining} of ${s.limit} demo questions left today.` });
        else if (demoTurn.reason === 'user') send({ type: 'note', text: `You've used all ${s.limit} AI questions for this demo, so this answer is from the built-in assistant.` });
        else if (demoTurn.reason === 'global') send({ type: 'note', text: 'The demo AI is resting for today, so this answer is from the built-in assistant.' });
      }
    }
    send({ type: 'done' });
  } catch (e) {
    if (!abort.signal.aborted) {
      console.error('chat stream error:', e);
      send({ type: 'error', text: 'The assistant hit an error. Try again.' });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
