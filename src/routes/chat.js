'use strict';

const express = require('express');
const { askStream } = require('../agent');

const router = express.Router();

// demo sandboxes always use the built-in rules assistant (see src/demo.js)
const backendFor = (req) => (req.user && req.user.demo ? 'rules' : (process.env.AI_BACKEND || 'rules').toLowerCase());

router.get('/chat/config', (req, res) => {
  const backend = backendFor(req);
  res.json({
    backend,
    model:
      backend === 'ollama'
        ? process.env.OLLAMA_MODEL || 'llama3.1:8b'
        : backend === 'anthropic'
        ? process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
        : 'built-in analysis',
    hasKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

// Server-Sent Events. Frames: {type:'meta'|'delta'|'note'|'done'|'error', ...}
router.post('/chat', async (req, res) => {
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is empty.' });
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();

  const send = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, 15000);
  const abort = new AbortController();
  // res 'close' fires on client disconnect (or after we finish). Only the former should abort.
  res.on('close', () => { if (!res.writableEnded) abort.abort(); clearInterval(heartbeat); });

  try {
    await askStream(req.user.id, message, history, send, { abortSignal: abort.signal, backend: backendFor(req) });
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
