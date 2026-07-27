# Pulse

The Strapi team's internal tool for tracking sentiment across social mentions, capturing the full response trail, and turning recurring signals into product decisions.

- **Spec**: [`06-build-spec.md`](06-build-spec.md) (stages 1–5 in the sibling `0*.md` files)
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
| `npm run test:e2e` | Playwright suite (11 tests) against the running dev servers |
| `npm run db:export` / `npm run db:import` | snapshot / restore Strapi data via `seed-data.tar.gz` |

### Demo data (dev only)

Start the CMS once with `PULSE_SEED_DEMO=true` to get 10 pre-analyzed mentions, topics, events, 2 example responses, a dead letter, and three team accounts (`dana` / `mark` / `priya`, password `PulseDemo1!`). Production starts **empty by design** — data collection is greenfield.

### AI is optional

Without `AI_API_KEY`, Pulse **runs fully** — mentions ingest, the queue/claim/respond/outcome loop, Slack notifications, search, and the activity trail all work. The three AI features are cleanly **disabled** (not degraded with fake heuristics): automatic sentiment/topic analysis (mentions get `analysisStatus: skipped`; labeling is manual via "Set sentiment / topics"), draft generation (button hidden; API returns 503), and chat (page shows a disabled notice). Add a key later and the cron sweep **auto-analyzes previously skipped mentions**. The frontend reads `GET /api/insights/config` (`{ aiEnabled }`).

### Webhook smoke test

```bash
curl -X POST http://localhost:1337/api/ingest/octolens \
  -H 'content-type: application/json' -H "x-pulse-secret: $OCTOLENS_WEBHOOK_SECRET" \
  -d '{"id":"t-1","text":"Strapi v5 docs are great","platform":"x","author":{"handle":"tester"}}'
# analyzed by the cron sweep within ~1 minute; malformed payloads → dead letter + ops alert
```

## Deploy (user-performed)

1. **Strapi → Strapi Cloud**: create a project at https://cloud.strapi.io, connect this repo, root dir `apps/cms`, Node ≥ 20. Set env vars: `OCTOLENS_WEBHOOK_SECRET`, `AI_API_KEY`, `AI_MODEL`, `AI_DAILY_TOKEN_BUDGET`, `STRAPI_DOCS_MCP_URL`, `SLACK_WEBHOOK_URL`, `SLACK_OPS_WEBHOOK_URL`, `PULSE_APP_URL`, `STALE_AFTER_DAYS` (DB + core secrets are auto-injected). **Verify backups are active on your plan.**
2. **Frontend → Vercel**: import repo, root dir `apps/web`, set `NEXT_PUBLIC_STRAPI_URL` to the Strapi Cloud URL.
3. **CORS**: set `strapi::cors` origin in `apps/cms/config/middlewares.ts` to the Vercel URL.
4. **Octolens** — all integration is Strapi-backend-only:
   - **Pull-sync (primary)**: with `OCTOLENS_API` set, Strapi pulls mentions every 5 minutes (`OCTOLENS_SYNC_CRON` to change). This is the active ingestion path.
   - **Webhook (ready, currently blocked upstream)**: `https://<strapi-cloud-url>/api/ingest/octolens?secret=<OCTOLENS_WEBHOOK_SECRET>` (or header `x-pulse-secret`). ⚠️ As of 2026-07-27 Octolens' webhook validator false-positives on Strapi Cloud's public Cloudflare IPs (`172.66/16` misread as private) and refuses the URL — bug reported. The endpoint is live and verified; deliveries start working the moment they fix their range check.
5. **MCP clients** (Claude Desktop etc.): the `/mcp` endpoint requires an **Admin Token** (`kind: admin`) — a classic content-API token is rejected. Create one scoped to read-only reporting (verified on 5.51):
   ```
   POST /admin/admin-tokens   (as a logged-in admin)
   { "name": "pulse-mcp-reporting", "lifespan": null,
     "adminPermissions": [
       { "action": "plugin::content-manager.explorer.read", "subject": "api::mention.mention" },
       { "action": "plugin::content-manager.explorer.read", "subject": "api::topic.topic" },
       { "action": "plugin::content-manager.explorer.read", "subject": "api::event.event" } ] }
   ```
   Connect to `POST https://<strapi-cloud-url>/mcp` with `Authorization: Bearer <accessKey>`. The token's permissions gate tool visibility — this token sees only read tools for those three types plus the custom `pulse-search-mentions`, `pulse-trend-summary`, `pulse-theme-report`.
