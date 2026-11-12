# Ledger — the AI assistant (design)

Status: proposal. Builds on what exists today (`src/agent.js`, `src/retrieve.js`, `src/analytics.js`,
`public/assets/assistant.js`); nothing here is implemented yet.

Ledger answers questions about **your own money** ("where did my money go in August?"), general
**finance questions** ("what is an emergency fund?"), and **shows charts** when asked ("chart my
dining spend over the last six months").

## 1. Principles

1. **Code computes numbers; the model explains them.** Every amount, count, percentage and chart
   value comes from `analytics.js` or the database, never from the model's own arithmetic.
   Today the LLM backends get a pasted summary and add things up themselves; that goes away.
2. **Retrieval is for finding, not summing.** RAG finds *which* transactions a question is about;
   totals over them come from SQL. When the match set is too loose to sum (see the C-group eval
   results), Ledger says so instead of guessing.
3. **Works with no model at all.** The `rules` backend (the Render default) gets charts and
   grounded answers too. Ollama and Claude make it conversational, not correct.
4. **One user's data, always.** Every tool takes `userId` from the session, never from the model.
5. **No personalised investment advice.** Ledger explains concepts and your own numbers; it does
   not recommend securities or products.

## 2. Architecture

```
question ──► planner ──► tools ──► grounding check ──► SSE ──► chat page
              │            ├─ analytics   (exact totals, trends, breakdowns)
              │            ├─ txn search  (RAG over the user's transactions)
              │            ├─ finance guide (RAG over curated finance notes)
              │            └─ chart builder (chart spec from analytics data)
              └─ rules router | Ollama tool calling | Claude tool use
```

### 2.1 Planner

| Backend | How it plans |
|---|---|
| `rules` | Existing intent router in `viaRules`, plus chart intents (§4.3) and a finance-guide intent. |
| `anthropic` | Claude tool use: the model gets the tool list (§3) and a short system prompt, calls tools, then writes the answer. Replaces the pasted `buildSummary` block. |
| `ollama` | Same tool loop via Ollama's `tools` field (llama3.2 / llama3.1 support it). If the model returns no tool call, fall back to `rules` for the numbers and let the model only phrase them. |

A turn allows at most 4 tool calls and one chart; the loop stops on the first answer.

### 2.2 Follow-ups

The chat keeps the last **resolved filters** (month(s), category, merchant, topic) per conversation,
sent back by the client alongside `history`. "And last month?" re-runs the previous tool with the
month shifted, instead of re-parsing from scratch.

## 3. Tools

All tools are plain functions in a new `src/tools.js`, each `(userId, args) -> { data, text, sources }`,
validated with a small schema (month = `YYYY-MM`, category ∈ `CATEGORIES`, limits capped).

| Tool | Args | Backed by | Returns |
|---|---|---|---|
| `month_summary` | `month` | `analytics.kpis`, `categoryBreakdown` | spend, income, savings rate, top categories |
| `category_spend` | `month`, `category?` | `categorySpend` | amount, count, share, vs 3-month average |
| `monthly_trend` | `months` (≤ 24), `category?`, `merchant?` | `monthlyTotals` | series per month |
| `top_merchants` | `month`, `limit` | `topMerchants` | ranked merchants |
| `compare_months` | `a`, `b` | `monthTotals` + breakdowns | deltas by category |
| `search_transactions` | `query`, `month?`, `category?`, `min?`, `max?` | `retrieve()` (hybrid RAG) | top rows + exact SQL totals when filters decide the match |
| `topic_spend` | `topic`, `months?` | `retrieve()` + strict match rule | total **only** if the match set is tight, else closest rows and a "can't total reliably" flag |
| `finance_guide` | `question` | finance KB RAG (§5) | 1–3 passages with titles |
| `show_chart` | `kind`, `metric`, `months?`, `category?`, `merchant?` | chart builder (§4) | a chart spec (sent to the client, not to the model) |

`sources` are transaction ids or guide-note ids; the client renders them as "Based on 14
transactions" (opens Transactions filtered to those ids) or "From: Emergency funds".

## 4. Visuals

### 4.1 Chart spec

The server sends charts as data; the client draws them with the same hand-rolled SVG/CSS style as
Reports (no chart library, works offline).

```json
{
  "id": "c1",
  "kind": "bar | line | donut | table",
  "title": "Dining, Mar–Aug 2026",
  "unit": "currency | count | percent",
  "x": ["2026-03", "2026-04", "2026-05"],
  "series": [{ "name": "Dining", "values": [4210, 3890, 5120], "color": "dining" }],
  "note": "Aug is 31% above the 3-month average",
  "sources": { "query": "monthly_trend", "args": { "category": "Dining", "months": 6 } }
}
```

`color` is a category key (`--c-dining` …) or `in`/`out` (`--mint`/`--amber`). Values are always
computed server-side by the chart builder from the named query; the model can pick the chart but
never supplies its numbers.

### 4.2 Which chart

| Question shape | Chart |
|---|---|
| over time ("trend", "last 6 months", "month by month") | `line` (one series) or `bar` (≤ 12 points) |
| breakdown ("by category", "where did my money go") | `donut` (≤ 6 slices + "Other") |
| ranking ("top merchants", "biggest expenses") | horizontal `bar` |
| comparison ("this month vs last") | grouped `bar` |
| lists of transactions | `table` |

### 4.3 When to show one

Only when asked ("show", "chart", "graph", "plot", "visualise", "breakdown as a chart") or when
the answer is a series of 4+ numbers. Plain questions get plain text.

### 4.4 Streaming

New SSE events, added to the existing `meta` / `delta` / `note` / `done` / `error`:

| Event | Payload | When |
|---|---|---|
| `chart` | chart spec (§4.1) | as soon as the chart tool returns, before the text finishes |
| `sources` | `{ transactions: [ids], guides: [ids] }` | once, before `done` |

Older clients ignore unknown events, so the change is backwards compatible.

## 5. Finance guide (knowledge RAG)

- **Content:** ~30 short markdown notes in `kb/` written for this app: budgeting (50/30/20,
  envelope), emergency funds, debt (snowball vs avalanche), credit score basics, inflation, Indian
  specifics (UPI, how SIPs and FDs work, tax-saving sections at a concept level), and how Ledger's
  own numbers are computed. Each note has a title, a "last reviewed" date and no product
  recommendations.
- **Index:** notes split by heading into ~300-word chunks; lexical (BM25-lite, same as
  `retrieve.js`) plus embeddings in a new `kb_embed` table when `EMBED_ENABLED`.
- **Answering:** the model answers only from returned passages and names the note; if nothing
  scores above the cut-off, it says it doesn't have a note on that.
- **Mixed questions** ("am I saving enough for an emergency fund?") call both `finance_guide` and
  `month_summary`.

## 6. Grounding check

Before `done`, the server extracts numbers from the answer text (amounts, percentages, counts) and
checks each against the values in that turn's tool results (exact, or a rounding of one).
Unmatched numbers:

- in `rules`: impossible by construction;
- in LLM backends: the turn gets a `note` ("Some figures could not be verified") and the trace
  records them; in `evalMode` the turn fails.

## 7. Chat page

`public/assets/assistant.js` changes:

- render `chart` events into the message bubble with a new `LL.chart(spec)` helper in `shell.js`
  (shared with Reports later);
- render `sources` as a link row under the answer;
- render light markdown (bold, lists, tables) instead of plain text;
- starter chips that show off charts: "Chart my spending by category this month",
  "Show my dining trend for 6 months".

## 8. Evaluation

Extend `eval/` (tune/test split rules unchanged):

| Set | Checks |
|---|---|
| existing 50 questions | answer correctness, retrieval recall/precision (no regressions) |
| ~15 chart questions | right `kind`; values equal the analytics query exactly |
| ~15 finance-guide questions | right note retrieved; answer cites it; "no note" when out of scope |
| grounding | share of LLM answers with every number verified (target 100% for rules, ≥ 95% for LLMs) |

## 9. Build order

| Phase | Scope | Needs a model? |
|---|---|---|
| 1 | Chart builder + `chart` SSE event + chat rendering; rules backend answers chart requests | no |
| 2 | `src/tools.js`; Claude tool use replaces the pasted summary; `sources` event | Claude for testing |
| 3 | Ollama tool loop with rules fallback | local Ollama |
| 4 | Finance guide notes + KB retrieval + eval set | optional |
| 5 | Grounding check; stricter `topic_spend` matching (fixes the C-group questions) | no |

Phase 1 alone delivers "show me visuals when asked" on the deployed `rules` backend.

## 10. Open questions

- **Default backend in production:** `rules` is free and deterministic; `anthropic` is far more
  conversational but costs per question and sends a summary of the user's numbers to the API.
- **Name:** "Ledger" is a working name for the assistant and may follow the app rename
  (e.g. "Ask Kanso").
