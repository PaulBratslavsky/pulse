# Setting Pulse up on a new machine

Everything needed to go from a bare Mac to a running Pulse stack.

**No secrets in this file, deliberately.** It names every variable and says where to
get its value. Keep it in git; keep the values in a password manager.

---

## 1. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Node | **24.16.0** | The repo declares no `engines` and has no `.nvmrc`. Strapi Cloud requires ≥ 20. Match 24.x to match this machine. |
| npm | **11.13.0** | Ships with Node 24. The repo uses npm workspaces — don't substitute pnpm/yarn. |
| git | any recent | |
| `gh` CLI | any recent | Only for PRs/CI; not needed to run the app. |

```bash
nvm install 24.16.0 && nvm use 24.16.0
```

## 2. Clone and install

```bash
git clone https://github.com/PaulBratslavsky/pulse.git
cd pulse
npm run setup
```

`npm run setup` installs all workspaces and copies `.env.example` → `.env` (cms) and
`.env.local` (web). **It skips files that already exist**, so it is safe to re-run.

Then fill in the variables below and:

```bash
npm run dev
```

Strapi comes up on **:1338**, Next waits for its health check, then starts on **:3000**.

---

## 2b. Shortcut: coming from an existing machine

If the old machine still works, don't retype anything. `scripts/handoff.sh`
packages the three things git cannot carry — `apps/cms/.env`,
`apps/web/.env.local` and `~/.config/mcp/` — plus an optional database
snapshot, into one passphrase-encrypted zip with a `RESTORE.sh` inside.

```bash
# on the OLD machine
bash scripts/handoff.sh          # writes ~/Desktop/pulse-handoff-<date>.zip

# move it by AirDrop / encrypted USB / password-manager attachment,
# sending the passphrase separately — then on the NEW machine:
unzip pulse-handoff-<date>.zip
bash RESTORE.sh ~/work/pulse
```

The script is safe to keep in git: it contains no secrets, it only collects
them. **Its output is the opposite** — live API keys and MCP bearer tokens — so
that never goes near git, email or chat, and gets deleted from both machines
once the new one works.

Even taking the shortcut, read **§3 "Generate fresh"** below: the crypto
material should be regenerated rather than copied, with one exception
(`JWT_SECRET` / `ENCRYPTION_KEY` travel with a restored database).

---

## 3. Backend variables — `apps/cms/.env`

### Generate fresh on the new machine (do NOT copy)

These are local-only crypto material. Copying them across machines buys nothing and
spreads secrets. Any random values work locally; Strapi Cloud injects its own in prod.

| Variable | How to generate |
|---|---|
| `APP_KEYS` | two comma-separated random strings |
| `API_TOKEN_SALT` | `openssl rand -base64 32` |
| `ADMIN_JWT_SECRET` | `openssl rand -base64 32` |
| `TRANSFER_TOKEN_SALT` | `openssl rand -base64 32` |
| `JWT_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` |

> Regenerating `JWT_SECRET` invalidates existing user sessions, and `ENCRYPTION_KEY`
> must stay stable for any data Strapi encrypted with it. On a *fresh* local database
> neither matters. If you copy a database across, copy these two with it.

### Copy as-is (non-secret defaults)

```ini
HOST=0.0.0.0
PORT=1338
DATABASE_CLIENT=sqlite
DATABASE_FILENAME=.tmp/data.db
DATABASE_SSL=false
PULSE_APP_URL=http://localhost:3000
STALE_AFTER_DAYS=2
MCP_ENABLED=true
CRON_ENABLED=true
AI_DAILY_TOKEN_BUDGET=500000
OCTOLENS_WEBHOOK_SECRET=dev-secret-123
```

`OCTOLENS_WEBHOOK_SECRET` must stay `dev-secret-123` locally — the Playwright suite
injects mentions through the real webhook and expects that value. Use a real secret in
production only.

The Postgres vars (`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`,
`DATABASE_USERNAME`, `DATABASE_PASSWORD`) stay **empty** locally. SQLite is the local
database; Strapi Cloud injects Postgres in production.

### Carry over from the old machine / password manager

| Variable | Where to get it | Needed? |
|---|---|---|
| `AI_API_KEY` | Anthropic console (or whichever provider) | Optional — see below |
| `AI_PROVIDER` | `anthropic` \| `openai` \| `openai-compatible` | Set to `anthropic` |
| `AI_MODEL` | empty = provider default (`claude-haiku-4-5-20251001`) | Optional |
| `OCTOLENS_API` | Read-scope API key from app.octolens.com | Optional — empty disables pull-sync |

**AI is genuinely optional.** With `AI_API_KEY` empty, Pulse runs fully: ingest, the
queue/claim/respond loop, acknowledge, search, trends, themes all work. Only three
features switch off — sentiment analysis, draft generation, chat. Add a key later and
the cron sweep auto-analyzes everything it skipped.

**For a scratch machine, leaving `AI_API_KEY` and `OCTOLENS_API` empty is the safest
start** — no spend, no external calls, and nothing to leak.

### Optional, empty locally

`STRAPI_DOCS_MCP_URL`, `SLACK_WEBHOOK_URL`, `SLACK_OPS_WEBHOOK_URL` — empty means
log-only. Fine for local work.

### ⚠️ Known drift

This machine's `apps/cms/.env` is **missing two keys** that `.env.example` defines:

```ini
AI_CHAT_ENABLED=false     # the assistant can WRITE the queue, so it has its own switch
AI_BASE_URL=              # only for AI_PROVIDER=openai-compatible (Ollama, vLLM, …)
```

Add both on the new machine. `AI_CHAT_ENABLED` is a separate switch on purpose: an API
key alone enables classification, not the tool-calling agent.

---

## 4. Frontend variables — `apps/web/.env.local`

```ini
NEXT_PUBLIC_STRAPI_URL=http://localhost:1338
# NEXT_PUBLIC_PULSE_ENV=staging   # non-production deploys only — shows a banner
```

That is the whole file. No secrets: the JWT lives in an httpOnly cookie and every
authenticated call goes through the `/api/pulse` server-side proxy.

---

## 5. Running it

| Command | What it does |
|---|---|
| `npm run dev` | Strapi :1338 + Next :3000 |
| `npm run dev:demo` | same, but seeds demo data on first boot |
| `npm run backend` / `npm run frontend` | one side only |
| `npm run test:e2e` | Playwright suite |
| `npm run db:clean-e2e` | delete accumulated Playwright fixtures |
| `npm run db:export` / `db:import` | snapshot / restore local data |

### Demo accounts

`npm run dev:demo` (or `PULSE_SEED_DEMO=true npm run backend`) seeds three users —
`dana`, `mark`, `priya` — password `PulseDemo1!`, plus 10 pre-analyzed mentions.
The Playwright suite signs in as `dana@example.com`.

Production starts **empty by design**.

### Port conflicts

Strapi does **not** fall back to another port — it exits with
`The port 1338 is already used by another application`. Next *does* silently fall back
(3000 → 3002), which is worse, because the e2e suite still targets 3000.

```bash
lsof -nP -iTCP:1338 -sTCP:LISTEN     # find the squatter
```

To run alongside something already on 1338, override at launch rather than editing
files:

```bash
PORT=1339 npm run backend
NEXT_PUBLIC_STRAPI_URL=http://localhost:1339 npm run frontend
STRAPI_URL=http://localhost:1339 PW_BASE_URL=http://localhost:3000 npm run test:e2e
```

---

## 6. MCP connectors (optional, for driving Pulse from Claude)

Pulse's backend exposes Strapi's built-in MCP server at `POST /mcp`. To reach it from
Claude Code / Desktop without a token in a config file, this machine uses a shim:

```
~/.config/mcp/
  tokens.env    chmod 600 — KEY=<token> pairs, the only place secrets live
  headers.sh    headersHelper for clients that support one
  remote.sh     stdio shim for clients that don't (Claude Desktop)
  token.sh      token lookup
```

The connector entry is just:

```json
{
  "pulse-prod": {
    "type": "http",
    "url": "https://ambitious-diamond-2dbe462fe9.strapiapp.com/mcp",
    "headersHelper": "/Users/paul/.config/mcp/headers.sh"
  }
}
```

Copy `~/.config/mcp/` to the new machine (it is outside the repo), then fix the
hardcoded `PATH` in `remote.sh` — it points at a specific nvm Node version.

Token keys defined on this machine: `PULSE_MCP`, `PULSE_PROD`, `STRAPI_PULSE_PROD`,
plus unrelated ones. Generate the token in **Strapi admin → Settings → Admin Tokens**
(a classic content-API token is rejected by `/mcp`), then grant only the
**Settings → "Pulse MCP tools"** actions. Do not add content-manager permissions —
that re-exposes Strapi's generic CRUD tools, whose update flow requires resending the
whole record, and a truncated resend has silently overwritten a long post before.

### ⚠️ Production hostname

Pulse production is **`ambitious-diamond-2dbe462fe9.strapiapp.com`**.

There is a *different* Strapi project on this machine at
`deserving-harmony-9f5ca04daf.strapiapp.com` (the content/blog site). They are easy to
confuse and probing the wrong one gives misleading 404s on every route. Confirm which
you're hitting before concluding anything about a deploy:

```bash
# route exists but needs auth -> 403;  route absent -> 404
curl -s -o /dev/null -w "%{http_code}\n" https://<host>/api/muted-authors
```

---

## 7. Gotchas worth knowing

- **`apps/web/AGENTS.md` points at `node_modules/next/dist/docs/`, which does not
  exist** in this install (Next 16.2.11). Use the existing components as the
  convention reference instead.
- **The local database accumulates Playwright fixtures.** The suite ingests through the
  real webhook by design, so `e2e-*` mentions pile up — they reached 70% of all rows on
  this machine. Run `npm run db:clean-e2e` periodically, or local analytics and the
  theme report will be dominated by test junk.
- **Local e2e can fail where CI passes**, almost always because of the above. CI runs
  against clean seeded data; trust CI over a polluted local DB.
- `.vscode/` shows as untracked; the fix sits unmerged on branch `chore/ignore-vscode`.
