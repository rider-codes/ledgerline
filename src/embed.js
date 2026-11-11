'use strict';

/*
 * Semantic embeddings for transaction search, via a local Ollama embedding model.
 * Vectors are unit-normalized and stored as Float32 BLOBs in tx_embed.
 * Everything degrades to lexical-only search when Ollama / the model isn't reachable.
 */

const crypto = require('node:crypto');
const { db } = require('./db');
const { MONTH_NAMES } = require('./vocab');

const api = module.exports;

const enabled = () => String(process.env.EMBED_ENABLED || '').toLowerCase() === 'true'
  || (process.env.EMBED_ENABLED == null && (process.env.AI_BACKEND || '').toLowerCase() === 'ollama');
const model = () => process.env.EMBED_MODEL || 'nomic-embed-text';
const ollamaUrl = () => (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
// Defaults chosen by eval/tune.js on the tuning split (see eval/results/tuning.md).
const SEM_WEIGHT = () => Math.max(0, Math.min(1, parseFloat(process.env.RAG_SEMANTIC_WEIGHT || '1')));
const SEM_MIN = () => parseFloat(process.env.RAG_SEMANTIC_MIN || '0.6');

/* ---------------- Ollama calls ---------------- */

async function embedTexts(texts, { timeoutMs = 60_000 } = {}) {
  if (!texts.length) return [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    // /api/embed is the current endpoint; it accepts a string or an array in `input`.
    const res = await fetch(`${ollamaUrl()}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: model(), input: texts }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
    const data = await res.json();
    const vecs = data.embeddings || (data.embedding ? [data.embedding] : null);
    if (!vecs || !vecs.length) throw new Error('no embeddings in response');
    return vecs.map(normalize);
  } finally {
    clearTimeout(timer);
  }
}

async function embedQuery(text) {
  const [v] = await api.embedTexts([text], { timeoutMs: 20_000 });
  return v;
}

async function ping() {
  try {
    const v = await api.embedQuery('ping');
    return { ok: true, dim: v.length, model: model() };
  } catch (e) {
    return { ok: false, error: e.message, model: model() };
  }
}

/* ---------------- vector helpers ---------------- */

function normalize(vec) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  return vec.map((x) => x / n);
}
function cosine(a, b) {
  // both are unit vectors -> dot product
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}
const toBlob = (vec) => Buffer.from(Float32Array.from(vec).buffer);
// copy into an aligned Float32Array (no per-element boxing, so scoring a whole account stays cheap)
const fromBlob = (buf) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/* ---------------- document text + hashing ---------------- */

function docText(r) {
  const [y, mo] = r.date.split('-');
  const mName = MONTH_NAMES[Number(mo) - 1] || '';
  return `${r.merchant || r.note || 'transaction'} — ${r.category} — ${mName} ${y} — ${r.type} ${Math.round(r.amount)}`;
}
const docHash = (r) => crypto.createHash('sha1').update(docText(r)).digest('hex').slice(0, 16);

/* ---------------- store / load ---------------- */

const upsert = db.prepare(
  `INSERT INTO tx_embed (transaction_id, model, dim, doc_hash, vec, updated_at)
   VALUES (?, ?, ?, ?, ?, datetime('now'))
   ON CONFLICT(transaction_id) DO UPDATE SET
     model = excluded.model, dim = excluded.dim, doc_hash = excluded.doc_hash,
     vec = excluded.vec, updated_at = excluded.updated_at`
);

function storeVectors(rows, vecs) {
  const tx = db.prepare('BEGIN'); tx.run();
  try {
    rows.forEach((r, i) => upsert.run(r.id, model(), vecs[i].length, docHash(r), toBlob(vecs[i])));
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}

// Read in chunks: SQLite limits the number of bound parameters, and a query may now cover a whole account.
const ID_CHUNK = 500;
function loadVectors(ids, { hashOnly = false } = {}) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const rows = db
      .prepare(`SELECT transaction_id, doc_hash${hashOnly ? '' : ', vec'} FROM tx_embed WHERE transaction_id IN (${chunk.map(() => '?').join(',')}) AND model = ?`)
      .all(...chunk, model());
    for (const r of rows) out.set(r.transaction_id, { hash: r.doc_hash, vec: hashOnly ? null : fromBlob(r.vec) });
  }
  return out;
}

/* ---------------- indexing ---------------- */

// Embed any of these rows that are missing / stale. Bounded so a query stays fast.
async function ensureIndexed(rows, cap = 80) {
  if (!enabled() || !rows.length) return { added: 0 };
  const have = loadVectors(rows.map((r) => r.id), { hashOnly: true });
  const stale = rows.filter((r) => {
    const h = have.get(r.id);
    return !h || h.hash !== docHash(r);
  }).slice(0, cap);
  if (!stale.length) return { added: 0 };
  const vecs = await api.embedTexts(stale.map(docText));
  storeVectors(stale, vecs);
  return { added: stale.length };
}

// (Re)index a user's transactions, bounded per call so the HTTP request can't run
// past the server timeout. Call again while `remaining > 0` to finish a large set.
async function reindexUser(userId, { force = false, batch = 64, max } = {}) {
  const cap = Math.max(batch, parseInt(max ?? process.env.EMBED_REINDEX_MAX ?? '2000', 10) || 2000);
  const all = db
    .prepare('SELECT id, date, amount, type, category, merchant, note FROM transactions WHERE user_id = ? ORDER BY id')
    .all(userId);
  const have = force ? new Map() : loadVectors(all.map((r) => r.id), { hashOnly: true });
  const todo = all.filter((r) => {
    const h = have.get(r.id);
    return !h || h.hash !== docHash(r);
  });
  const thisRun = todo.slice(0, cap);
  let done = 0;
  for (let i = 0; i < thisRun.length; i += batch) {
    const chunk = thisRun.slice(i, i + batch);
    const vecs = await api.embedTexts(chunk.map(docText));
    storeVectors(chunk, vecs);
    done += chunk.length;
  }
  return {
    total: all.length,
    embedded: done,
    alreadyCurrent: all.length - todo.length,
    remaining: todo.length - done,
    model: model(),
  };
}

function status(userId) {
  const total = db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id = ?').get(userId).c;
  const indexed = db
    .prepare(
      `SELECT COUNT(*) c FROM tx_embed e JOIN transactions t ON t.id = e.transaction_id
       WHERE t.user_id = ? AND e.model = ?`
    )
    .get(userId, model()).c;
  return { enabled: enabled(), model: model(), total, indexed };
}

/* ---------------- ranking hook used by retrieve.js ---------------- */

// Given candidate rows + a query, return a Map(id -> semanticScore in [0,1]) or null.
//
// Default behaviour (the app): lazily embeds up to 80 missing rows, and returns null
// (-> lexical only) if Ollama is unreachable.
//
// Eval behaviour: `readOnly` never writes to tx_embed; `strict` never returns null —
// it throws if embeddings are disabled, Ollama fails, or ANY candidate row lacks a
// current vector. A strict run therefore cannot silently degrade to keyword-only.
async function semanticScores(rows, query, { readOnly = false, strict = false } = {}) {
  if (!rows.length) return null;
  if (!enabled()) {
    if (strict) throw new Error('semantic search requested but embeddings are disabled (set EMBED_ENABLED=true)');
    return null;
  }
  let qVec;
  try {
    if (!readOnly) await api.ensureIndexed(rows);
    qVec = await api.embedQuery(query);
  } catch (e) {
    if (strict) throw new Error(`semantic search failed: ${e.message}`);
    return null; // Ollama unreachable -> lexical only
  }
  if (!qVec) {
    if (strict) throw new Error('semantic search failed: no query vector');
    return null;
  }
  const vecs = loadVectors(rows.map((r) => r.id));
  if (strict) {
    const missing = rows.filter((r) => {
      const h = vecs.get(r.id);
      return !h || h.hash !== docHash(r);
    });
    if (missing.length) {
      throw new Error(`embedding index incomplete: ${missing.length} of ${rows.length} candidate rows have no current ${model()} vector`);
    }
    const bad = rows.find((r) => vecs.get(r.id).vec.length !== qVec.length);
    if (bad) throw new Error(`embedding dimension mismatch (query ${qVec.length}, row ${bad.id} ${vecs.get(bad.id).vec.length})`);
  }
  const out = new Map();
  for (const r of rows) {
    const h = vecs.get(r.id);
    if (h) out.set(r.id, cosine(qVec, h.vec));
  }
  return out.size ? out : null;
}

Object.assign(api, {
  enabled, model, SEM_WEIGHT, SEM_MIN,
  embedTexts, embedQuery, ping,
  reindexUser, ensureIndexed, status, semanticScores,
  docText, docHash,
});
