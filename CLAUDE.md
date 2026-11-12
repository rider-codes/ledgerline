# Ledgerline

Local-first personal finance tracker. Users sign up, import bank/card CSVs, get transactions auto-categorized, see a dashboard and reports, and chat with an assistant about their spending.

## Run

Needs Node >= 22.5 (uses `node:sqlite`, which requires the `--experimental-sqlite` flag — the npm scripts already pass it).

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # same, with --watch
npm run seed       # demo data: demo@example.com / demo1234 (~850 txns, Jul 2025–Sep 2026; `-- --legacy` = the original 271 rows the eval is labelled on)
npm run reset      # wipe + reseed
```

Copy `.env.example` to `.env`. Nothing is required; every value has a default.

## Stack

Node + Express 4 (CommonJS), SQLite via `node:sqlite`, `cookie-session`, `bcryptjs`, `multer`. No build step. Frontend is vanilla JS, one script per page, plus a shared `shell.js` (sidebar + `window.LL` helpers). Charts are hand-rolled CSS/SVG — no chart library, works offline.

## Layout

```
server.js            Express entry: session secret, /healthz, /assets/config.js, routes, error handler
src/
  paths.js           DATA_DIR / default DB path / session-secret path (no side effects)
  db.js              SQLite connection + schema + CATEGORIES (single source of the category list)
  auth.js            signup / login / requireAuth
  ratelimit.js       in-memory fixed-window rate limiter (login, signup)
  csv.js             CSV parser, column auto-detect, income/expense type detection, dedupe hash
  categorize.js      CSV category -> user rules -> keyword map -> Naive Bayes -> "Uncategorized"
  analytics.js       all spending math + buildSummary() markdown digest for the LLM
  agent.js           assistant: rules | ollama | anthropic backends, SSE streaming
  retrieve.js        RAG: structured filters + BM25-lite, optional semantic blend
  embed.js           Ollama embeddings (nomic-embed-text) stored in tx_embed
  vocab.js           category synonyms, stopwords, tokenizer
  seed.js            deterministic demo data
  routes/            auth, analytics, transactions (+ CSV import), rules, embed, chat
public/              *.html pages + assets/ (per-page JS, shell.js, styles.css, sample CSVs)
eval/                retrieval eval harness (see "Retrieval eval" below)
mockups/             original design mockups (reference only, not served)
DESIGN.md            system design doc
DEPLOY.md            deployment guide (Render); render.yaml is the Blueprint
README.md            user-facing docs
```

Pages: Dashboard `/`, Transactions, Categories & Rules, Reports (Cash Flow / Spending / Income tabs), Assistant, Import CSV, Login, Signup. The sidebar also shows a "Settings" item, but it is a placeholder (`href="#"`) — there is no settings page or route.

## Conventions

- Amounts are stored as positive numbers (`REAL`, `> 0`); direction lives in `type` (`expense` | `income`). Validate with `parseAmount()` in `routes/transactions.js` — rejects non-finite, <= 0, >= 1e12.
- Months are `YYYY-MM` strings; dates are `YYYY-MM-DD`. Do month arithmetic in `analytics.js`, not ad hoc.
- Anything that computes spending numbers goes through `analytics.js` so the dashboard, reports, and assistant never disagree.
- Every query is scoped by `user_id`. Keep it that way.
- Imports dedupe on `sha1(user|date|amount|desc)` (`import_hash`, partial unique index).
- 5xx responses are generic (`Server error`); only deliberate 4xx messages reach the client.

## Assistant

`AI_BACKEND` picks the engine:

- `rules` (default) — deterministic intent router + retrieval; no dependencies.
- `ollama` — local model at `OLLAMA_URL` (this machine uses `llama3.2:3b`; embeddings use `nomic-embed-text`).
- `anthropic` — Claude API; needs `ANTHROPIC_API_KEY`.

Demo sandboxes (`DEMO_MODE=true`, `src/demo.js`) use the built-in `rules` backend unless `DEMO_ANTHROPIC_API_KEY` is set, in which case `src/demoai.js` gives them a small cloud model with per-sandbox and site-wide daily budgets (table `ai_usage`). That key is server-side only: never put it in `config.js`, a response, a log line or git. `DEMO_ONLY=true` (implies `DEMO_MODE`) removes real accounts: `/login` and `/signup` redirect to `/`, and `POST /api/login` / `/api/signup` return 403 (`noAccounts` in `routes/auth.js`); `/about` always serves the landing page. Signed-out visitors get `public/landing.html` at `/`; its Clone-from-GitHub button come from `GITHUB_URL`.

`POST /api/chat` streams Server-Sent Events (`meta` / `delta` / `note` / `done` / `error`). Abort on `res.on('close')`, not `req.on('close')` — the request stream closes as soon as the body is read.

## Retrieval eval

A 50-question eval comparing keyword, semantic and blended retrieval. Question format, gold-label rules and scoring definitions are in `eval/FORMAT.md`; check a question file with `node --experimental-sqlite eval/validate-questions.js <file> [--db <snapshot>]`.

- `retrieve(userId, query, opts)` takes `mode` (`auto` = the app's own logic | `lexical` | `semantic` | `hybrid`), `weight`, `semMin`, `defaultMonth`, and `evalMode`. It also returns per-row `scores`, the true `matchCount`, and `sqlTotals` (uncapped SQL totals — `totalSpend`/`totalIncome` are only sums over the returned rows).
- `evalMode` never writes embeddings and throws instead of degrading (embeddings off, Ollama down, any candidate row not embedded, LLM backend failure). Use it for every eval run.
- `ask(userId, msg, history, { retrieval, evalMode })` returns `{reply, mode, model, note, trace}`; `trace` has the handler (`route`), retrieved row ids, scores, filters and counts.
- `analytics.pinDefaultMonth(userId, ym)` pins "this month" so results don't drift with the clock.
- **Never run eval tooling against `data/finance.db`.** Work on a snapshot copy (`eval/snapshots/`, git-ignored — it contains password hashes) and set `DB_PATH` to it; `eval/lib/guard.js` refuses the live file.

## Gotchas

- **Asset caching:** `/assets` is served `no-store`, but pages still carry `?v=N` query strings on script/style tags. Bump them when you change a shared asset.
- **Currency:** the symbol comes from `CURRENCY` via `GET /assets/config.js` (`window.__CURRENCY__`), loaded before `shell.js`. Currently `₹`.
- **`requireAuth` and API paths:** it checks `req.originalUrl`, not `req.path` (which is mount-relative under `/api`), so API 401s return JSON instead of redirecting.
- **Session secret:** if `SESSION_SECRET` is blank, one is generated into `data/.session-secret`.
- **Never commit** `.env` or `data/` (DB, WAL files, session secret). Both are git-ignored.
- `[hidden]` is forced `display:none !important` in `styles.css`; for elements that set inline `display`, toggle `style.display` explicitly (see `import.js` `setStep`).

## Sample data

`public/assets/` has `sample-bank-export.csv`, `sample-card-export.csv`, and `sample-household-inr.csv` (2,125 real INR rows, 2015–2018, derived from the Kaggle "Daily Household Transactions" dataset). The household file needs `Type` = expense/income detection, which `csv.js` handles.

## Deployment status

Prepared for Render, not yet deployed. This is a stateful Express app with a local SQLite file and SSE, so it does **not** fit Vercel as-is. Steps and settings are in `DEPLOY.md`; `render.yaml` is the Blueprint (persistent disk at `/var/data`, `AI_BACKEND=rules`).

- `DATA_DIR` (resolved in `src/paths.js`, no side effects) holds the DB and `.session-secret`; `DB_PATH` still overrides the DB file alone.
- `NODE_ENV=production` makes the session cookie `secure` and sets `trust proxy` to 1 (`TRUST_PROXY` overrides; `0` disables). Without trust proxy, the secure cookie is never sent and every visitor shares the proxy's IP in the rate limiter.
- Node is pinned to 22.x (`engines`, `.node-version`).
