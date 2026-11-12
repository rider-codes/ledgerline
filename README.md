# Ledgerline

A local-first personal finance tracker. Import a bank/card CSV, see where the money
goes day-to-day and month-to-month, and ask a local AI assistant where you overspent
and where to cut back. Your data lives in a SQLite file on your machine — nothing is
sent anywhere unless you explicitly point the assistant at a cloud model.

## Requirements

- **Node.js 22.5 or newer** (uses the built-in `node:sqlite`; runs with the
  `--experimental-sqlite` flag, wired into the npm scripts).
- No build step, no native compilation.

## Setup

```bash
npm install
cp .env.example .env      # optional — every setting has a default
npm run seed              # creates a demo account with ~4 months of data
npm start
```

Open <http://localhost:3000>.

Demo login: **demo@example.com** / **demo1234** (created by `npm run seed`).
Or click *Create an account* to start empty.

Scripts:

| command | what it does |
|---|---|
| `npm start` | run the server |
| `npm run dev` | run with `--watch` (restarts on file changes) |
| `npm run seed` | wipe the demo user's data and regenerate it |
| `npm run reset` | wipe **all** data, then regenerate the demo user |

## What's in it

- **Dashboard** — KPI cards, spend-over-time (monthly / daily toggle), spend by
  category, top merchants, recent transactions, and a docked assistant.
- **Transactions** — filter by month / category / type, edit a transaction's
  category inline (which teaches the classifier), add or delete transactions.
- **Categories & Rules** — keyword rules → your own rules → an on-device Naive Bayes
  classifier that learns from every correction. An "Uncategorized" queue with
  suggestions to triage.
- **Reports → Cash Flow** — a Sankey of income → categories → savings for a month.
- **Assistant** — a chat page (and the dashboard dock) that answers "where did I
  overspend", "where can I save", "compare to last month", "unused subscriptions"
  with numbers drawn from your data.
- **Import CSV** — drag in a file, confirm the detected column mapping, preview, and
  import. Duplicate rows (same date + amount + description) are skipped, so
  re-importing the same statement is safe.

Example files to try the importer with are in `public/assets/`:

| file | shape | notes |
|---|---|---|
| `sample-bank-export.csv` | `Posting Date, Description, Amount` (signed) | small, ~1 month |
| `sample-card-export.csv` | `Transaction Date, Description, Category, Debit, Credit` | small, ~1 month |
| `sample-household-inr.csv` | `Date, Description, Category, Type, Amount` | **2,125 real transactions, Jan 2015 – Sep 2018.** Derived from the public *Daily Household Transactions* dataset (Kaggle `prasad22`, GitHub-mirrored), remapped to Ledgerline's category vocabulary. Amounts are INR — set `CURRENCY=₹` in `.env` for the right symbol. |

## The AI assistant — three backends

Set `AI_BACKEND` in `.env`:

| value | needs | notes |
|---|---|---|
| `rules` *(default)* | nothing | Deterministic analysis computed from your data. Always works, fully offline. |
| `ollama` | [Ollama](https://ollama.com) running locally | `ollama pull llama3.1:8b` then `ollama serve`. Set `OLLAMA_MODEL` to taste. Free, private, offline. |
| `anthropic` | `ANTHROPIC_API_KEY` | Uses `claude-sonnet-5` via the official SDK. A Claude Pro/Max subscription is **not** an API key — get one at <https://console.anthropic.com>. |

If a chosen backend is unavailable (Ollama not running, no API key, network error)
the assistant automatically falls back to `rules` and tells you it did.

Answers **stream** token-by-token (Server-Sent Events) for the `ollama` and `anthropic`
backends, so a slow local model shows progress instead of a blank wait; `rules` answers
arrive whole (they're instant). Tuning knobs in `.env`: `RAG_LLM_ROWS`,
`OLLAMA_NUM_PREDICT`, `OLLAMA_KEEP_ALIVE`, `ANTHROPIC_MAX_TOKENS`.

### Retrieval (RAG)

Every question also runs through a retriever (`src/retrieve.js`) before it's answered:

1. It parses **structured filters** from the question — amount (`over $100`, `between 40 and 60`),
   month, category, income/expense.
2. Narrows the transactions with those filters, then ranks the rest with a **BM25-lite lexical
   score** over `date + merchant + category + note`.
3. The top `RAG_MAX_ROWS` (default 40) rows are added to the LLM prompt as a
   `RELEVANT TRANSACTIONS` block, so `ollama` / `anthropic` can answer about *specific*
   transactions ("what was that $47 charge", "list every purchase over $200 in July"), not
   just the monthly aggregates.
4. The `rules` backend uses the same retriever directly for search-style questions
   ("show me my Shell charges", "charges over $500").

No vector database and no extra dependencies — retrieval is plain JS (`node:sqlite` has no
FTS5).

#### Semantic search (hybrid, optional)

Turn on embeddings to also match by *meaning* ("gas station" → Shell, "eating out" →
Chipotle, `AMZN` → Amazon):

1. `ollama pull nomic-embed-text` (and have `ollama serve` running).
2. In `.env`: `EMBED_ENABLED=true` (already on if `AI_BACKEND=ollama`). Restart.
3. **Categories & Rules** page → *Semantic search* card → **Build index**. Vectors are
   stored (unit-normalized Float32 BLOBs) in the `tx_embed` table; new/changed rows are
   re-embedded automatically when they turn up in a search.

Ranking then blends the lexical BM25 score with embedding cosine similarity
(`RAG_SEMANTIC_WEIGHT`, default 1; `RAG_SEMANTIC_MIN`, default 0.6, gates weak semantic-only matches; both tuned with `eval/tune.js`).
If Ollama or the embed model isn't reachable, search silently falls back to lexical-only.
`src/embed.js` holds the whole thing; `src/retrieve.js` calls into it.

## Data & privacy

- Everything is stored in `data/finance.db` (SQLite, git-ignored); set `DATA_DIR`
  to keep it elsewhere.
- Passwords are hashed with bcrypt. The session is a signed cookie; if
  `SESSION_SECRET` is unset the app generates and persists a strong one at
  `data/.session-secret` on first run (set your own in `.env` to override).
- With `AI_BACKEND=rules` or `ollama`, no transaction data leaves your machine.
  With `anthropic`, a summary of your monthly totals and category breakdown is sent
  to the Claude API to answer each question.

## Deploying

See [DEPLOY.md](DEPLOY.md). Short version: a host with a persistent disk (Render
Blueprint in `render.yaml`), `NODE_ENV=production`, `DATA_DIR` on the disk, and
`AI_BACKEND=rules`. Serverless hosts such as Vercel don't fit (temporary filesystem).

## Notes / limitations

- `node:sqlite` prints an `ExperimentalWarning` on startup — harmless.
- No email verification or password reset (single-machine app).
- Bank aggregation (Plaid / Teller / GoCardless) is intentionally not built — the
  `source` column and CSV pipeline leave room to add a connector later.
- Charts are drawn with plain CSS/SVG (no chart library, no CDN) so the app works
  fully offline.

## Layout

```
server.js              Express app: sessions, static assets, route mounting, auth guard
src/
  db.js                SQLite schema + connection
  auth.js              signup / login / logout + requireAuth middleware
  seed.js              demo account generator (deterministic)
  csv.js               CSV parse, column detection, row normalization
  categorize.js        keyword rules + user rules + Naive Bayes classifier
  analytics.js         every spending aggregation (used by API and assistant)
  retrieve.js          RAG retriever — structured filters + BM25-lite + hybrid semantic rank
  embed.js             Ollama embeddings: index / store / cosine for semantic search
  vocab.js             shared NL vocabulary (synonyms, months, stopwords, tokenizer)
  agent.js             assistant: data summary + rules / ollama / anthropic backends
  routes/              auth, transactions (+ import), rules, analytics, embed, chat
public/
  *.html               pages (login, signup, dashboard, transactions, rules, reports, assistant, import)
  assets/              styles.css, shell.js, per-page scripts, sample CSVs
data/                  finance.db (created at runtime, git-ignored)
```
