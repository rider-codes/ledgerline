'use strict';

const express = require('express');
const embed = require('../embed');

const router = express.Router();

router.get('/embed/status', async (req, res) => {
  const s = embed.status(req.user.id);
  let reachable = null;
  if (s.enabled) {
    const p = await embed.ping();
    reachable = p.ok;
    s.error = p.ok ? undefined : p.error;
    s.dim = p.dim;
  }
  res.json({ ...s, reachable });
});

router.post('/embed/reindex', async (req, res) => {
  if (!embed.enabled()) {
    return res.status(400).json({ error: 'Semantic search is off. Set EMBED_ENABLED=true (or AI_BACKEND=ollama) in .env and restart.' });
  }
  const p = await embed.ping();
  if (!p.ok) {
    return res.status(502).json({ error: `Embedding model not reachable: ${p.error}. Run "ollama pull ${embed.model()}" and make sure "ollama serve" is running.` });
  }
  try {
    const t0 = Date.now();
    const out = await embed.reindexUser(req.user.id, { force: !!(req.body && req.body.force) });
    res.json({ ...out, ms: Date.now() - t0 });
  } catch (e) {
    console.error('reindex error:', e);
    res.status(500).json({ error: 'Indexing failed partway through. Some vectors may be saved — try again to continue.' });
  }
});

module.exports = router;
