# Deploying Ledgerline

Ledgerline is a long-running Express server with a SQLite file on disk and streaming (SSE) chat
responses. It needs a host that keeps one process running and gives it a **persistent disk**.
Render is the documented target; Railway works the same way. Serverless hosts (e.g. Vercel) do not
fit: their filesystem is temporary, so every user and transaction would be lost.

## What production needs

| Setting | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | HTTPS-only session cookie; trusts one proxy hop |
| `DATA_DIR` | the disk's mount path, e.g. `/var/data` | DB + session secret survive redeploys |
| `SESSION_SECRET` | long random string | signs login cookies; keep it stable or everyone is logged out |
| `DEMO_MODE` | `true` for a public showcase | Adds "Explore with sample data" to the login page: every visitor gets a private sandbox account with sample transactions, always on the built-in assistant, deleted after `DEMO_TTL_HOURS` (24); at most `DEMO_MAX_ACTIVE` (100) at once; 5 per hour per IP. Set `false` for a private install. |
| `AI_BACKEND` | `rules` | no Ollama on the server; `anthropic` also works with `ANTHROPIC_API_KEY` |
| `EMBED_ENABLED` | `false` | semantic search needs a local Ollama |
| `CURRENCY` | e.g. `₹` | symbol shown in the UI |
| `TRUST_PROXY` | leave unset | defaults to 1 in production; set only if there are more proxy hops |

Node is pinned to 22.x (`package.json` `engines`, `.node-version`); `npm start` passes
`--experimental-sqlite`.

## Render (Blueprint)

`render.yaml` describes everything above: one web service on the `starter` plan, a 1 GB disk
mounted at `/var/data`, health check on `/healthz`, and a generated `SESSION_SECRET`.

1. Push this repository to GitHub (or GitLab / Bitbucket).
2. In the Render dashboard: **New → Blueprint**, pick the repository, and apply.
3. Wait for the first deploy, then open the `*.onrender.com` URL and sign up.
4. Optional: add a custom domain under the service's **Settings → Custom Domains**.

A persistent disk needs a paid instance type. A service with a disk runs as a single instance and
has a few seconds of downtime on each deploy (the disk moves to the new instance).

## After deploying

- **Do not run `npm run seed` in production.** It creates `demo@example.com` with the public
  password `demo1234`. Use `DEMO_MODE=true` instead for a public demo: its sandbox accounts
  cannot be signed in to again and expire on their own.
- **Backups:** the whole state is `$DATA_DIR/finance.db` (+ `-wal`/`-shm`). Render takes daily disk
  snapshots; for an off-site copy, open the service's **Shell** and run
  `node --experimental-sqlite -e "new (require('node:sqlite').DatabaseSync)('/var/data/finance.db').exec(\"VACUUM INTO '/var/data/backup.db'\")"`,
  then download `backup.db`.
- **Logs:** `[ledgerline]` lines and 5xx stack traces go to the service's **Logs** tab.
- **Updating:** push to the deployed branch; `autoDeploy` rebuilds and restarts.

## Known gaps

- The sidebar's **Settings** item is a placeholder and goes nowhere.
- There is no password reset or email verification.
- Rate limits (login, signup) are in memory, so they reset on every restart.
