# Pulse

The Strapi team's tool for tracking sentiment across social mentions, capturing the full response trail, and turning recurring signals into product decisions.

Mentions flow in from [Octolens](https://octolens.com) (webhook + pull-sync, all handled by the Strapi backend), land in a triage queue, and walk a tracked workflow — claim → reply (posted manually on the platform, recorded in Pulse) → outcome — with a full audit trail. Competitor threads can be **acknowledged** (closed without a public reply, reason recorded) and annotated with internal-only notes. Trends, themes, and a 0–100 Pulse score come out the other end. AI is optional everywhere; when enabled it adds sentiment analysis, docs-grounded reply drafts, and a chat assistant. The same six tools the assistant uses are exposed over Strapi's built-in **MCP server**, so Claude Desktop / Claude Code can read the queue and save reply drafts for human review.

- **Docs**: [`docs/architecture.md`](docs/architecture.md) — system overview, data model, ingestion, permissions, tool registry
- **Spec**: [`06-build-spec.md`](06-build-spec.md) (stages 1–5 in the sibling `0*.md` files; revision log at the bottom)
- **Backend**: Strapi v5 (≥ 5.49) — `apps/cms` (local plugins in `apps/cms/src/plugins/`)
- **Frontend**: Next.js 16 (App Router) — `apps/web`

## Local dev — two commands

```bash
npm run setup     # installs all workspaces + copies .env.example → .env / .env.local (skips existing)
npm run dev       # starts Strapi (:1337), waits for its health check, then starts Next.js (:3000)
```

That's it — SQLite locally (Postgres on Strapi Cloud), and the copied env defaults work out of the box (webhook secret matches the e2e suite; AI stays disabled until you set `AI_API_KEY`).

Other root scripts:

| Script | What it does |
|---|---|
| `npm run dev:demo` | same as `dev`, but seeds demo data on first boot (10 mentions, 3 users — `dana`/`mark`/`priya`, password `PulseDemo1!`) |
| `npm run backend` / `npm run frontend` | run one side only |
| `npm run test:e2e` | Playwright suite (18 tests) against the running dev servers |
| `npm run db:export` / `npm run db:import` | snapshot / restore local Strapi data via `seed-data.tar.gz` (local file, not tracked in git) |

### Demo data (dev only)

Start the CMS once with `PULSE_SEED_DEMO=true` to get 10 pre-analyzed mentions, topics, events, 2 example responses, a dead letter, and three team accounts (`dana` / `mark` / `priya`, password `PulseDemo1!`). Production starts **empty by design** — data collection is greenfield.

### AI is optional

Without `AI_API_KEY`, Pulse **runs fully** — mentions ingest (with Octolens' own sentiment adopted as the initial, provenance-stamped label), the queue/claim/respond/outcome loop, acknowledge + internal notes, Slack notifications, search, and the activity trail all work. The three AI features are cleanly **disabled** (not degraded with fake heuristics): automatic sentiment/topic analysis, draft generation, and chat. Add a key later and the cron sweep **auto-analyzes previously skipped mentions**; human corrections are never overwritten. The frontend reads `GET /api/insights/config` (`{ aiEnabled }`).

### Webhook smoke test

```bash
curl -X POST http://localhost:1337/api/octolens/ingest \
  -H 'content-type: application/json' -H "x-pulse-secret: $OCTOLENS_WEBHOOK_SECRET" \
  -d '{"id":"t-1","text":"Strapi v5 docs are great","platform":"x","author":{"handle":"tester"}}'
# analyzed by the cron sweep within ~1 minute; malformed payloads → dead letter + ops alert
```

## Deploy

1. **Strapi → Strapi Cloud**: create a project at https://cloud.strapi.io, connect this repo, root dir `apps/cms`, Node ≥ 20. Set env vars: `OCTOLENS_WEBHOOK_SECRET`, `OCTOLENS_API`, `AI_API_KEY`, `AI_MODEL`, `AI_DAILY_TOKEN_BUDGET`, `STRAPI_DOCS_MCP_URL`, `SLACK_WEBHOOK_URL`, `SLACK_OPS_WEBHOOK_URL`, `PULSE_APP_URL`, `STALE_AFTER_DAYS` (DB + core secrets are auto-injected). **Verify backups are active on your plan.**
2. **Frontend → Vercel**: import repo, root dir `apps/web`, set `NEXT_PUBLIC_STRAPI_URL` to the Strapi Cloud URL.
3. **CORS**: set `strapi::cors` origin in `apps/cms/config/middlewares.ts` to the Vercel URL.
4. **Octolens** — all integration is Strapi-backend-only:
   - **Pull-sync (primary)**: with `OCTOLENS_API` set, Strapi pulls mentions every 5 minutes (`OCTOLENS_SYNC_CRON` to change). Manual "Sync now" (with report) lives on the Octolens page in the Strapi admin.
   - **Webhook (ready, currently blocked upstream)**: `https://<strapi-cloud-url>/api/octolens/ingest?secret=<OCTOLENS_WEBHOOK_SECRET>` (or header `x-pulse-secret`). ⚠️ As of 2026-07-27 Octolens' webhook validator false-positives on Strapi Cloud's public Cloudflare IPs (`172.66/16` misread as private) and refuses the URL — bug reported. The endpoint is live and verified; deliveries start working the moment they fix their range check.

## Connecting AI clients (MCP)

The backend exposes Strapi's built-in MCP server at `POST /mcp` with nine Pulse tools — queue (semantic
filters + paging), mention detail, **save-draft**, **update-mention** (partial), **save-drafts-bulk**,
**acknowledge**, search, trends, themes — the same registry the in-app assistant uses. Drafts saved by an
agent pre-fill the reply form for a human to review and post; **nothing auto-posts**, and write tools
never expose the mention body, so an agent can't overwrite a post's content.

1. In the Strapi admin, create an **Admin Token** (Settings → Admin Tokens — a classic content-API token is rejected by `/mcp`).
2. On the token's permission screen, open the **Settings tab → "Pulse MCP tools"** and check the tools this token may call (per-tool, granular; four of the nine are writes, marked `(write)`). The **Plugins tab → octolens** separately gates the plugin's admin sync UI. ⚠️ Grant **only** these actions — adding content-manager permissions re-exposes Strapi's generic CRUD tools, whose update flow requires resending the whole record (a truncated resend silently overwrote a long post in a real session).
3. Point your client at the endpoint, e.g. Claude Desktop `claude_desktop_config.json`:
   ```json
   "pulse": {
     "command": "npx",
     "args": ["-y", "mcp-remote", "https://<strapi-url>/mcp",
              "--header", "Authorization: Bearer <admin-token-access-key>"]
   }
   ```

Unchecking a tool's box revokes it for that token immediately — permissions are managed entirely from the admin UI.
