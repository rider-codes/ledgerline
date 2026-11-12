# Eval question file format

One JSON file (`eval/questions.json`, created in Phase 2) holds all 50 questions for both datasets.
`eval/questions.example.json` shows one of each shape. Check a file with:

```bash
node --experimental-sqlite eval/validate-questions.js eval/questions.json --db eval/snapshots/eval.db
```

Without `--db` it checks structure only. With `--db` it also checks that every gold id exists and belongs to the
right user, and recomputes every `sql` / `analytics` / `goldSum` / `goldCount` source against the database.
That database must be a **snapshot copy** — the validator refuses the live `data/finance.db`.
Add `--final` to also require exactly 50 questions, a 35/15 tune/test split, and every question `confirmed`.

## Building and labelling

The demo-account questions are labelled against the original seed (May to Sep 2026, 271 rows). The default
`npm run seed` now adds Jul 2025 to Apr 2026 as well, so seed with `npm run seed -- --legacy` before snapshotting.
The original rows and ids are identical either way; the longer dataset only adds more rows.

```bash
node --experimental-sqlite eval/make-snapshot.js --embed     # copy of the live DB (read-only), embedded; git-ignored
node --experimental-sqlite eval/build-questions.js           # questions.json + labeling-pools.json + labeling-worksheet.md
# ... tick merchants in eval/labeling-worksheet.md ...
node --experimental-sqlite eval/apply-labels.js              # ticks -> goldIds, recomputes answer.expected
node --experimental-sqlite eval/validate-questions.js eval/questions.json --db eval/snapshots/eval.db --final
```

`build-questions.js` holds every question spec; gold ids and `expected` values are regenerated from SQL / `analytics.js`.
It refuses to overwrite confirmed labels or ticked boxes unless `--force` is passed. All eval scripts refuse the live DB.
Splits are seeded (`meta.splitSeed`) and fixed before any retrieval number exists.

## File shape

```json
{
  "meta": {
    "version": 1,
    "k": 20,
    "datasets": {
      "demo": { "userEmail": "demo@example.com", "defaultMonth": null },
      "real": { "userEmail": "real@example.com", "defaultMonth": null }
    },
    "snapshotSha256": null
  },
  "questions": [ { ... }, { ... } ]
}
```

- `k` — cut-off for every retrieval metric (20).
- `defaultMonth` — per dataset, the month "this month" / "last month" resolve to. Left `null` in drafts;
  Phase 3 fills it from `analytics.defaultMonth` on the snapshot and pins it for every run.
- `snapshotSha256` — hash of the snapshot DB the gold ids refer to. Gold ids are only valid for that file.

## A question

| field | required | meaning |
|---|---|---|
| `id` | yes | `<group>-<nn>`, unique, prefix equals `group` (e.g. `C-07`) |
| `group` | yes | `A` structured filters · `B` merchant/name variants · `C` vague phrasing · `D` vague + filter · `E` dates/ranges · `F` aggregate over retrieved rows · `G` unanswerable |
| `dataset` | yes | `demo` or `real` |
| `split` | yes | `tune` (35) or `test` (15). Assigned once, stratified by group, **before any number is computed**. Tuning only ever looks at `tune`; headline numbers come from `test`. |
| `question` | yes | exactly what is typed into the assistant |
| `knownGap` | no | `true` for questions that exercise a *known* parser gap (mostly group E). Still scored; also reported separately. |
| `retrieval` | yes | gold for retrieval metrics, or `null` if the question is not a retrieval question |
| `answer` | yes | gold for answer correctness |
| `notes` | no | free text |

### `retrieval`

```json
{ "goldBasis": "sql" | "manual",
  "goldIds": [101, 102],
  "sql": "SELECT id FROM transactions WHERE user_id = :userId AND ...",
  "labelStatus": "draft" | "confirmed",
  "candidateIds": [101, 102, 140],
  "labelNotes": "why 140 was excluded" }
```

- `goldBasis: "sql"` — the ids are exactly what `sql` returns (`:userId` is bound per dataset). Use this for groups A, B, F, G, where the structured facts are not in doubt.
- `goldBasis: "manual"` — a human decided which transactions the question is asking about. **Required for C and D.**
  Gold is never derived from the `category` column (it is a classifier output, and the retriever filters on it).
- `candidateIds` — suggestions to help a human label. **Never scored.** Delete or keep them; the scorer ignores them.
- Only `labelStatus: "confirmed"` questions are scored. Drafts are listed but excluded, so an unlabelled question can't leak into a number.
- Group G: `goldIds: []` — the right behaviour is returning nothing.

### `answer`

```json
{ "type": "number" | "count" | "abstain",
  "source": { "analytics": "A.monthTotals(userId,'2026-08').spend" }
          | { "sql": "SELECT SUM(amount) FROM transactions WHERE user_id = :userId AND ..." }
          | { "goldSum": true } | { "goldCount": true },
  "expected": 560.5,
  "tolerance": 0.01 }
```

- `source` says how `expected` is computed; `expected` is **written by a script from `source`, never typed by hand**.
  - `analytics` — a JS expression evaluated with `A` (src/analytics.js), `db` and `userId` in scope (trusted, repo-authored).
  - `sql` — one row, one column.
  - `goldSum` / `goldCount` — sum / count over the confirmed `retrieval.goldIds`.
- `tolerance` — absolute; default `0.01` (one paisa) for `number`, `0` for `count`.
- `abstain` has no `expected`: correct means the system says it found nothing.

### How an answer is judged (fixed now, before any baseline)

- `number`: every amount in the reply is parsed (currency symbol and thousands separators stripped); correct if **any** is within `tolerance` of `expected`. An "amount" is a number written with the currency symbol (`₹560.50`); bare numbers such as dates, counts and percentages are ignored.
- `count`: the first integer directly followed by `transaction(s)|charge(s)|purchase(s)|order(s)|payment(s)|row(s)` must equal `expected`.
- `abstain`: correct if the reply matches `/couldn'?t find|no (transactions?|spending|expenses?|data|records?)|nothing|none|don'?t see/i`.

### How retrieval is judged

For each question with confirmed gold and `k` = 20, over the ids returned by `retrieve()`:
**Recall@20** (gold ids in the top 20 / min(gold size, 20) — so a question with 67 gold rows can still score 1.0), **hit rate** (≥ 1 gold id in the top 20), **Precision@20** (gold in top 20 / rows returned), **MRR** (1 / rank of first gold).
A question that returns no rows scores 0 on all four. Group G is scored as `abstainOk` (returned zero rows) and left out of the four averages above.
Questions with `retrieval: null` count only toward answer correctness.

## Running the eval

```bash
node --test eval/score.test.js                                        # scorer unit tests
node --experimental-sqlite eval/run-eval.js --label baseline --pin    # first run: pins default months + snapshot hash
node --experimental-sqlite eval/run-eval.js --label <name>            # later runs
```

Output goes to `eval/results/<label>.json` (every question, retrieved ids, replies) and `<label>.md` (tables).

Conditions, all with the same `k`: **keyword** (`mode: lexical`), **semantic** (`mode: semantic`), **blended**
(`mode: hybrid`, weight 0.5, cut-off 0.5 unless overridden with `--weight` / `--semMin`) and **app default**
(`mode: auto`, what the app does today: filtered rows newest-first when no search words are left, otherwise blended).
Answers come from `ask()` with the deterministic rules backend, so only questions routed to its search handler
can differ between conditions. Reported numbers are rounded down to 4 decimals.
The run aborts if any question is unconfirmed, the snapshot hash differs from the pinned one, any transaction
lacks a current embedding, Ollama is unreachable, or the snapshot content changes during the run.
