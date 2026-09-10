# Ledgerline — System Design

A local-first personal finance tracker: import a bank/card CSV, see where the money
goes, and ask a local assistant where you overspent and where to cut. Everything runs
on one machine; data lives in a single SQLite file.

---

## 1. Requirements

### Functional

| Capability | Detail |
|---|---|
| **Accounts** | Email + password sign-up / sign-in; each user's data is private. |
| **Ingestion** | Upload a bank/card CSV → detect columns → preview → import. Dedupe re-imports. |
| **Categorization** | Auto-assign a category to each transaction; learn from corrections. |
| **Dashboard** | KPIs, spend-over-time (daily/monthly), category breakdown, top merchants, recent activity, scoped by month. |
| **Reports** | Cash-flow Sankey (income → categories → savings) per month. |
| **Ledger** | Filter, inline-edit category, add/delete transactions. |
| **Assistant** | Chat that answers "where did I overspend / where can I save / compare months / find charges over $X" from the user's own data. |
| **Retrieval (RAG)** | Pull the transactions relevant to a question into the answer / the LLM prompt. |

### Non-functional

- **Local-first & private.** No account server, no telemetry. With `AI_BACKEND` = `rules` or `ollama`, no data leaves the machine.
- **Zero-config.** `npm install && npm run seed && npm start` — no external services, no build step, no native compilation.
- **Offline-capable.** Charts are hand-rolled CSS/SVG; no CDN scripts. Only Google Fonts is remote (and degrades).
- **Graceful degradation.** Every optional dependency (Claude API, Ollama, embeddings) has a fallback with a user-visible note.
- **Small & legible.** ~15 source modules, plain CommonJS, vanilla-JS frontend.

### Constraints

- Node.js ≥ 22.5 (built-in `node:sqlite`, run with `--experimental-sqlite`).
- Single developer, single process, single user per install.
- No cloud budget; "deploy" = run `node server.js`.

### Explicit non-goals

Multi-tenant hosting, horizontal scale, real-time collaboration, mobile apps,
bank aggregation (Plaid/Teller/GoCardless) — designed *for* but not built.

---

## 2. High-Level Design

### Component diagram

```
┌──────────────────────────── Browser ────────────────────────────┐
│  Static pages (public/*.html)  +  per-page vanilla JS            │
│  shell.js  → sidebar, fetch helper (api()), esc(), toast()       │
│  dashboard.js / transactions.js / rules.js / reports.js /        │
│  assistant.js / import.js / auth.js                              │
└───────────────┬─────────────────────────────────────────────────┘
                │  fetch  (JSON over HTTP, cookie session)
┌───────────────▼─────────────────────────────────────────────────┐
│                        server.js  (Express)                      │
│  cookie-session · express.json · /assets static (no-store)       │
│  session-secret bootstrap · global error handler (generic 5xx)   │
│                                                                  │
│   /api/*  ──► routes/auth      (open: signup/login/logout/me)     │
│              routes/analytics  (dashboard, months, cashflow)      │
│   requireAuth routes/transactions (CRUD + /import/*)              │
│              routes/rules      (rules CRUD, NB model stats)       │
│              routes/embed      (semantic index status/reindex)    │
│              routes/chat       (assistant)                        │
└───────┬───────────────┬───────────────┬───────────────┬──────────┘
        │               │               │               │
┌───────▼──────┐ ┌──────▼───────┐ ┌─────▼──────┐ ┌──────▼────────┐
│ analytics.js │ │ categorize.js│ │  agent.js  │ │  retrieve.js  │
│ (all spend   │ │ keyword →    │ │ rules /    │ │ filters +     │
│  math)       │ │ user rules → │ │ ollama /   │ │ BM25-lite +   │
│              │ │ Naive Bayes  │ │ anthropic  │ │ hybrid  ──────┼──► embed.js
└───────┬──────┘ └──────┬───────┘ └─────┬──────┘ └──────┬────────┘   (Ollama
        │               │               │               │            /api/embed)
        └───────────────┴───────┬───────┴───────────────┘
                                │
                     ┌──────────▼───────────┐        ┌───────────────┐
                     │  db.js  (node:sqlite) │        │  Ollama       │  optional
                     │  data/finance.db (WAL)│        │  localhost    │  local
                     └──────────────────────┘        │  :11434       │
                                                     └───────────────┘
                                          ┌───────────────┐
                                          │ Anthropic API │  optional, only if
                                          │ (Claude)      │  AI_BACKEND=anthropic
                                          └───────────────┘
```

### Request flows

**Dashboard load**
```
GET /  → requireAuth → sendFile(index.html)
dashboard.js → GET /api/dashboard?month=YYYY-MM
  routes/analytics → analytics.{kpis,monthlyTotals,dailySeries,categoryBreakdown,topMerchants}
  → ~15 small indexed SQLite reads → one JSON payload → render (CSS/SVG charts)
```

**CSV import**
```
import.js  → POST /api/import/preview {csv}
  csv.preview → parse + detectMapping + 5-row sample  → mapping UI
import.js  → POST /api/import/commit {csv, mapping, positiveMeans}
  csv.normalizeAll → rows[]  (row cap enforced)
  load existing import_hash set
  BEGIN
    for each row: dedupe(hash) → categorize(userId, desc, csvCat) → INSERT
  COMMIT   (ROLLBACK + generic 500 on failure)
  → {inserted, duplicates, uncategorized, skipped, byCategory}
```

**Assistant question** (Server-Sent Events)
```
assistant.js → POST /api/chat {message, history[]}   (Accept: text/event-stream)
  routes/chat → SSE: writes `data: {json}\n\n` frames, `res.on('close')` aborts the LLM
  agent.askStream(userId, message, history, emit, {abortSignal}):
    summary   = analytics.buildSummary(userId)         # monthly totals, category deltas, subs
    systemBase= SYSTEM_PROMPT + summary
    ragBlock  = retrieve.retrieve(k≈20) → "RELEVANT TRANSACTIONS" block
    switch AI_BACKEND:
      rules     → viaRules(): regex-route → answer* fns → one `delta` frame (instant)
                  · search-shaped question → retrieve.searchAnswer()
      ollama    → streamOllama(): POST OLLAMA_URL/api/chat {stream:true}
                  → NDJSON deltas → `delta` frames        (fall back to rules on failure)
      anthropic → streamAnthropic(): client.messages.stream(...).on('text', …)
                  → `delta` frames                        (fall back to rules if no key / error)
  frames: {meta,mode,model} · {delta,text}… · {note,text}? · {done}
```
`agent.ask()` (non-streaming, `{reply,mode,note}`) is kept as a thin wrapper over
`askStream` for tests / internal callers.

---

## 3. Data Model

SQLite, `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=3000`.
All domain rows carry `user_id` and every query is scoped by it.

```sql
users(
  id PK, email UNIQUE, password_hash, name, created_at )

transactions(
  id PK,
  user_id      → users.id  ON DELETE CASCADE,
  date         TEXT  'YYYY-MM-DD',
  amount       REAL  > 0,                 -- sign lives in `type`, not the number
  type         TEXT  'expense' | 'income',
  category     TEXT,                      -- fixed vocabulary (see below)
  merchant     TEXT,
  note         TEXT,
  source       TEXT  'manual' | 'csv' | <future: plaid/teller/...>,
  import_hash  TEXT  NULL,                -- sha1(user|date|amount|desc) for CSV dedupe
  created_at   TEXT )
  INDEX (user_id, date)
  UNIQUE INDEX (user_id, import_hash) WHERE import_hash IS NOT NULL   -- partial

rules(
  id PK, user_id →, match_text TEXT, category TEXT, created_at )
  INDEX (user_id)

nb_model(
  user_id PK →, payload TEXT (JSON: {docs, classDocs, tokens, classTokens, vocab}), updated_at )

tx_embed(
  transaction_id PK → transactions.id ON DELETE CASCADE,
  model      TEXT,                        -- embedding model name
  dim        INTEGER,
  doc_hash   TEXT,                        -- hash of embedded text; re-embed on mismatch
  vec        BLOB,                        -- Float32 little-endian, unit-normalized
  updated_at TEXT )
```

**Category vocabulary** (fixed, in `db.js`): `Groceries, Dining, Transport, Housing,
Utilities, Entertainment, Shopping, Health, Travel, Subscriptions, Education, Misc,
Income, Uncategorized`. Fixed so the classifier, rules, charts, and colors all agree.

**Why these choices**

- **One SQLite file.** Matches "local-first, zero-config". WAL gives readers-don't-block-writers; a single Node process means write contention is nil.
- **`amount` always positive + `type`.** Avoids sign-convention bugs across import formats; every aggregate is `SUM(CASE WHEN type='expense' ...)`.
- **`import_hash` partial unique index.** Makes re-importing a statement a no-op at the DB layer; manual rows (`import_hash NULL`) are exempt.
- **NB model as a JSON blob per user.** The model is tiny (token counts); a blob is simpler than a token table and is read/written whole, atomically, by synchronous code.
- **Embeddings in a side table keyed by `transaction_id`** with `ON DELETE CASCADE` and a `doc_hash` staleness marker — so recategorizing or deleting a transaction self-heals the index.

---

## 4. API Surface (REST / JSON)

Cookie session (`ledgerline.sid`, signed, httpOnly, SameSite=Lax). No CSRF token
(mitigation: SameSite + JSON-only + same-origin; see §7).

### Open

| Method | Path | Body → Result |
|---|---|---|
| POST | `/api/signup` | `{email,password,name}` → `{user}` + sets session. Rate-limited. |
| POST | `/api/login` | `{email,password}` → `{user}` + sets session. Rate-limited. |
| POST | `/api/logout` | → `{ok}` clears session. |
| GET  | `/api/me` | → `{user}` or 401. |

### Auth-guarded

| Method | Path | Notes |
|---|---|---|
| GET | `/api/months` | `{months:[YYYY-MM], default}` |
| GET | `/api/dashboard?month=` | KPIs + monthly[6] + daily[] + categories[] + merchants[6] |
| GET | `/api/reports/cashflow?month=` | income/expenses/net/savingsRate + `flows[]` for the Sankey |
| GET | `/api/transactions?month=&category=&type=&limit=&offset=` | `{rows,total,categories}` (limit clamped ≤ 500) |
| POST | `/api/transactions` | manual add; `amount` validated finite / >0 / < 1e12 |
| PATCH | `/api/transactions/:id` | partial update; category change → `learn()` + `ruleSuggestion` |
| DELETE | `/api/transactions/:id` | scoped by `user_id` |
| GET | `/api/uncategorized` | queue + NB `guess`/`confidence` per row |
| POST | `/api/import/preview` | multipart `file` **or** `{csv}`; optional `{mapping,positiveMeans}` |
| POST | `/api/import/commit` | `{csv,mapping,positiveMeans}` → counts; row cap `IMPORT_MAX_ROWS` |
| GET | `/api/rules` | rules + live match counts |
| POST | `/api/rules` | `{match_text,category,applyExisting?}` → `{rule,updated}` |
| DELETE | `/api/rules/:id` | |
| GET | `/api/model` | NB stats: `corrections`, `classes`, `autoMatchRate` |
| GET | `/api/embed/status` | `{enabled,model,total,indexed,reachable,error?}` |
| POST | `/api/embed/reindex` | bounded per call; returns `{embedded,remaining,total,ms}` |
| GET | `/api/chat/config` | `{backend,model,hasKey}` |
| POST | `/api/chat` | `{message,history[≤8]}` → `{reply,mode,note?}` |

### Pages

`GET /login /signup` (redirect to `/` if authed) · `GET / /transactions /rules
/reports /assistant /import` (all `requireAuth`) · `GET /assets/*` static.

---

## 5. Deep Dives

### 5.1 Categorization pipeline (`categorize.js`)

`categorize(userId, merchantText, csvCategory)` resolves in strict order and returns
`{category, via}`:

```
1. csvCategory          if the CSV supplied one and it maps to a known category   → via:'csv'
2. user rules           first rules.match_text that is a case-insensitive
                        substring of the merchant (longest match first)           → via:'rule'
3. built-in keyword map  ~200 substrings grouped by category, priority-ordered
                        (Subscriptions before Entertainment for Netflix, etc.)     → via:'keyword'
4. Naive Bayes           multinomial, Laplace-smoothed, over merchant+note tokens;
                        used only if docs ≥ 15 and softmax confidence ≥ 0.62       → via:'model'
5. else 'Uncategorized'                                                            → via:'fallback'
```

**Online learning.** Any category correction in the UI calls
`learn(userId, "<merchant> <note>", newCategory)` → load JSON model, `trainModel`
(increment class/token counts), save. It's a full read-modify-write, but the handlers
are synchronous so two corrections can't interleave. Recategorizing also *suggests* a
rule (`"<first 2 merchant words>" → category`) which, if accepted, is deterministic and
outranks the classifier.

**Trade-off:** rules are transparent and fast but brittle; NB generalizes ("SQ \*BLUE
BOTTLE" → Dining after learning "Blue Bottle Coffee") but is opaque. Layering gets
both, with rules as the escape hatch.

### 5.2 Analytics (`analytics.js`) — the single source of spend math

Every number the dashboard, reports, and assistant show comes from here, so they can
never disagree. Pure functions over indexed reads:

- `monthTotals(ym)`, `monthlyTotals(n)`, `categoryBreakdown(ym)` (current vs prev vs
  3-month average, with a `spike` flag), `dailySeries(ym)`, `topMerchants(ym)`,
  `kpis(ym)`, `recentTransactions(filter)`.
- `buildSummary(userId)` renders a compact markdown digest (6 months of totals, current
  category breakdown with deltas, top merchants, recurring subscriptions) — this is the
  LLM's grounding context.

Month math is string arithmetic on `YYYY-MM` (`addMonths`) — no `Date` timezone
hazards. `defaultMonth()` picks the latest **complete** month with ≥ 10 transactions so
the dashboard opens on a meaningful view, not a 3-day-old partial month.

### 5.3 Assistant (`agent.js`) — three interchangeable backends

```
AI_BACKEND = rules      (default)  deterministic analysis, zero deps, always works
           | ollama                local model via OLLAMA_URL/api/chat
           | anthropic             Claude via @anthropic-ai/sdk (lazy import)
```

`askStream()` builds the data summary once, dispatches on the env var, and streams
tokens back as SSE `delta` frames (`routes/chat.js`). It **always catches**: Ollama
unreachable, no API key, or an API error → if nothing was streamed yet, fall back to
`viaRules()` and emit a `note`; if the failure came mid-stream, keep the partial answer
and note that it was cut short. So the feature never hard-fails. `ollama` calls use
`keep_alive` (warm model) + `num_predict` (bounded output); the RAG block is capped
tighter for LLMs (`RAG_LLM_ROWS`, ~20) than for a raw search, since local models slow
down fast with context length.

`viaRules()` is a small intent router (regex over the normalized question) plus
entity extraction (`findCategory`, `findMerchant`, `findMonth`, `monthsInQuery`):

```
savings-rate · save · overspend · subscriptions · biggest · income · compare[A,B]
· search-shaped → retrieve.searchAnswer()
· merchant detected → answerMerchant       · category detected → answerCategory
· "total / how much" → answerTotal          · else → overview + capability hint
```

Each `answer*` function is grounded (cites months, categories, merchants, dollar
figures) and ends with a fixed "Not financial advice" line. The LLM backends get the
same grounding via the system prompt + the retrieval block.

### 5.4 Retrieval / RAG (`retrieve.js` + `embed.js`)

`node:sqlite` has no FTS5, so retrieval is plain JS.

```
retrieve(userId, query):
  1. parseFilters(query)      structured predicates from natural language:
       amount   "over $100", "between 40 and 60", "exactly 47"
       month    "last month", "in July", "2026-08"   (scoped to this user's months)
       type     income / expense
       category name or synonym (brand names like "doordash" stay as search terms)
  2. SQL narrow  WHERE user_id=? AND <predicates>  LIMIT 800  → candidates
  3. free-text terms = tokens minus stopwords minus filter-consumed minus numbers
  4. lexical score  BM25-lite over "date merchant category note amount" docs
                    + prefix-partial credit + whole-merchant-phrase bonus
  5. semantic (optional, EMBED_ENABLED):
       embed.semanticScores(candidates, query):
         · ensureIndexed(candidates)  — embed missing/stale rows (≤ 80/call)
         · embedQuery(query)          — one Ollama call
         · cosine(qVec, rowVec)       — vectors are unit-normalized → dot product
       final = (1-w)·lexNorm + w·cosine      (w = RAG_SEMANTIC_WEIGHT, default 0.5)
       a row qualifies if lexScore > 0  OR  cosine ≥ RAG_SEMANTIC_MIN (0.5)
     if Ollama/model unreachable → sem = null → pure lexical (silent)
  6. top-k rows + aggregate (count, spent, income)  →  mode: structured|lexical|hybrid
```

**Embedding storage.** `tx_embed.vec` is a Float32 LE BLOB (`Buffer.from(Float32Array…)`),
unit-normalized on write so similarity is a dot product. `doc_hash` detects staleness.
`reindexUser` is **bounded** (`EMBED_REINDEX_MAX`, default 2000 rows/call) and returns
`remaining`; the Rules page loops the call until done, so a large index can't outlast
the HTTP request timeout.

**Trade-off:** no vector DB, no ANN index — brute-force cosine over ≤ 800 candidates is
sub-millisecond at this scale and keeps the dependency count at zero. It would need
replacing (sqlite-vec, or a real store) somewhere north of ~10⁵ transactions.

### 5.5 CSV ingestion (`csv.js`)

- **Parser:** hand-written RFC-4180-ish state machine — quotes, escaped quotes, CRLF,
  newlines inside quotes. ~30 lines, no dependency.
- **Column detection:** exact then loose header matching against candidate name lists
  for `date / amount / debit / credit / description / category / type`. Two shapes
  handled: single signed `Amount`, or separate `Debit`/`Credit`.
- **Normalization:** `parseDate` (ISO, M/D/Y with a D/M/Y heuristic, then `Date`
  fallback), `parseAmount` (strips `$`/commas, parens = negative), sign → `type`.
  Non-finite / ≤ 0 / ≥ 1e12 rows are dropped.
- **Dedupe:** `sha1(userId | date | amount | description)` checked against existing
  hashes and within the batch.
- **Commit:** single `BEGIN…COMMIT`, `ROLLBACK` + generic 500 on any error, row cap
  `IMPORT_MAX_ROWS` (20000) rejects oversized files up front.

### 5.6 Auth & session

- **Passwords:** bcrypt cost 10 (`bcryptjs`, pure JS).
- **Session:** `cookie-session` — the signed cookie *is* the session (`{userId}`),
  no server store. `SESSION_SECRET` is used if set to a real value; otherwise the app
  generates 32 random bytes and persists them to `data/.session-secret` (git-ignored),
  reused across restarts. Never a shared default.
- **Rate limiting** (`ratelimit.js`): in-memory fixed-window. Login 8 / 15 min per
  IP+email, signup 5 / hr, plus 40 / 15 min per-IP against spraying. `429` + `Retry-After`.
- **`requireAuth`** middleware: API paths → `401 JSON`, page paths → `302 /login`.

---

## 6. Cross-Cutting Concerns

| Concern | Approach |
|---|---|
| **Config** | `.env` via `dotenv`; every key has a safe default. `.env.example` documents all. |
| **Concurrency** | `node:sqlite` `DatabaseSync` is synchronous → request handlers are effectively critical sections between `await` points. Only `/chat` and `/embed/*` await (network I/O); they mostly read. Writes are serialized by SQLite + WAL. |
| **Errors** | Deliberate `4xx` echo their message; unexpected `5xx` log server-side and return a generic string (no SQL/stack to the client). |
| **Static assets** | Served `Cache-Control: no-store` (dev ergonomics); `?v=N` query bump on HTML for hard cache-busting. |
| **Frontend safety** | Every `innerHTML` render path passes through `LL.esc()`; the assistant's markdown-lite escapes *before* applying `**bold**`. |
| **Observability** | `console` logs only. No metrics, no structured logging. |
| **Backup** | Copy `data/finance.db` (+ `-wal`, `-shm`). |

---

## 7. Scale & Reliability

### Load estimate (design point)

| Dimension | Expected | Comfortable ceiling |
|---|---|---|
| Users per install | 1 | a household (~5) |
| Transactions | 10³–10⁴ | ~10⁵ before retrieval/reindex need rework |
| Requests | human-paced, bursty on page load (~15 reads) | — |
| Concurrency | 1–2 | dozens (Node event loop; SQLite serializes writes) |

At the design point, every endpoint is single-digit milliseconds; the DB file is a few MB.

### Where it breaks first, in order

1. **Synchronous DB on the event loop.** Fine now (queries are µs). A pathological
   query or a 10⁵-row `categoryBreakdown` would block *all* requests for its duration.
   → move heavy analytics to a worker, or precompute monthly rollups.
2. **`/embed/reindex` and inline `ensureIndexed`** hold the request open during Ollama
   calls. Bounded today; at scale this wants a background job queue. (Chat itself is
   streamed via SSE, so a slow model shows progress rather than a blank wait.)
3. **Brute-force cosine** in retrieval — linear in candidates (≤ 800). Needs an ANN
   index past ~10⁵ vectors.
4. **`buildSummary()` runs on every `/chat`** even for the rules backend that only uses
   `summary.month`. ~10 wasted queries per turn — memoize per request.
5. **`cookie-session`** can't be revoked server-side and grows with payload; fine for
   `{userId}`, wrong for anything bigger.

### Reliability posture

- **No HA, by design.** One process, one file. If `node` dies, `systemd`/`pm2`/a shell
  loop restarts it; sessions survive (persisted secret), in-flight requests are lost.
- **Failure isolation that exists today:** LLM backend down → rules; Ollama/embeddings
  down → lexical retrieval; import error → transaction rollback, nothing written;
  reindex interrupted → partial vectors kept, resumes on next run (doc-hash).
- **Data durability:** WAL + `busy_timeout`. No automated backup — a `cron` `cp` or
  `sqlite3 .backup` is the recommended add.

---

## 8. Trade-off Analysis

| Decision | Chosen | Alternatives | Why / when to revisit |
|---|---|---|---|
| **Datastore** | `node:sqlite` (built-in) | `better-sqlite3` (native), Postgres | Zero deps, no compiler, no server — matches local-first. Revisit for multi-user hosting (→ Postgres) or if the experimental flag becomes a problem. |
| **Backend shape** | Single Express monolith, CommonJS | Fastify, NestJS, serverless, services | Smallest thing that works; one dev, one process. No reason to split until there's a second deployable. |
| **Frontend** | Static HTML + per-page vanilla JS + shared `shell.js` | React/Vue SPA, HTMX, SSR framework | No build step, no toolchain, trivially inspectable. Cost: manual DOM, duplicated helpers. Revisit if the UI gains real interactivity/state. |
| **Charts** | Hand-rolled CSS/SVG (bars, conic-gradient donut, SVG Sankey) | Chart.js / D3 / Recharts | Fully offline, no CDN, ~exact control, tiny. Cost: no tooltips/animation, more code per chart. Revisit if charts get interactive. |
| **Assistant default** | Rule-based analyzer | Always call an LLM | Works with zero setup, offline, free, deterministic, testable. LLM is opt-in for open-ended phrasing. |
| **AI integration** | `AI_BACKEND` env switch + graceful fallback | Hard dependency on one provider | Users pick privacy vs capability; the app degrades instead of erroring. |
| **Retrieval** | Structured filters + BM25-lite + optional embedding blend, all in JS | FTS5 (unavailable), a vector DB, Elastic | No new infra; honest "couldn't find" instead of dumping noise. Revisit past ~10⁵ rows or if semantic recall matters more than setup cost. |
| **Embeddings** | Ollama `nomic-embed-text`, vectors as SQLite BLOBs | Hosted embedding API, sqlite-vec, pgvector | Stays local and free; brute-force is fast at this scale. `embed.js` is isolated so the storage/rank layer can be swapped. |
| **Sessions** | Signed cookie (`cookie-session`) | Server session store (Redis/SQLite), JWT library | No store to run; `{userId}` is all we keep. Revisit if sessions need revocation or carry more state. |
| **Categorization** | keyword → user rules → Naive Bayes | Pure rules; a hosted classifier; an LLM per row | Transparent + adaptive + free + offline. LLM-per-row is slow and costs money; pure rules don't generalize. |
| **Auth hardening** | bcrypt + SameSite=Lax + in-memory rate limit | CSRF tokens, CSP, Argon2, persistent limiter | Proportionate to "localhost, one user". All of the omitted items are on the list for a hosted build (§9). |

---

## 9. What I'd Revisit As It Grows

**If it becomes multi-user / hosted**

- **Postgres** (or Turso/libSQL) instead of a local file; connection pooling; move the
  synchronous query pattern to `async` drivers.
- **Real sessions** with server-side store + revocation; **CSRF tokens** on mutations;
  **CSP** + security headers; **Argon2id**; per-account (not just per-IP) rate limits;
  email verification + password reset.
- **Background jobs** for embedding (re)indexing and any heavy analytics — a queue
  (BullMQ / pg-boss) so HTTP requests never wait on Ollama or big scans.
- **Precomputed monthly rollups** table, refreshed on write, so the dashboard is O(1)
  reads regardless of transaction count.
- **Observability:** structured logs, request metrics, error tracking, a `/healthz`.
- **Automated backups** + restore runbook.

**Product seams already in place for later**

- `transactions.source` column + the `csv.normalizeAll` → categorize → insert pipeline
  → a **bank-aggregation adapter** (Plaid/Teller/GoCardless) drops in as another
  `source` with the same downstream path; no schema change.
- `AI_BACKEND` dispatch → adding a provider is one `viaX()` function.
- `embed.js` fully isolates the vector layer → swapping to sqlite-vec / pgvector is
  contained.
- `analytics.js` as the single math source → any new surface (budgets, goals,
  net-worth) builds on the same aggregations.

**Engineering debt to pay down regardless of scale**

- **Tests.** No suite today. `csv.js` (mapping/parse edges), `categorize.js` (NB
  thresholds), `analytics.js` (month math across year boundaries), `retrieve.js`
  (`parseFilters`) are pure and cheap to cover first.
- **De-duplicate helpers** (`money`/`fmt` live in 4 modules; category→color in
  `shell.js` and `styles.css`) into a shared module / generated tokens.
- **`parseDate` `new Date()` fallback** is too permissive ("2026" → Jan 1) — tighten.
