# Pulse — Build Spec

> Hand this file to any coding agent (Claude Code, Cursor, etc.) — it is self-contained.
> **Build target**: Strapi v5 (**≥ 5.49.0**, MCP GA floor) on Strapi Cloud + Next.js 16 (App Router) on Vercel.
> **Docs lookup**: query the `strapi-docs` MCP if installed; otherwise WebFetch https://docs.strapi.io. Key pages: Document Service (https://docs.strapi.io/cms/api/document-service) · Controllers (https://docs.strapi.io/cms/backend-customization/controllers) · Routes & policies (https://docs.strapi.io/cms/backend-customization/routes) · Populate (https://docs.strapi.io/cms/api/rest/populate-select) · Users & Permissions (https://docs.strapi.io/cms/features/users-permissions) · Plugin development (https://docs.strapi.io/cms/plugins-development/developing-plugins) · MCP server (https://docs.strapi.io/cms/features/strapi-mcp-server) · Cron (https://docs.strapi.io/cms/configurations/cron). **Frontend**: Next.js https://nextjs.org/docs — verify version-sensitive conventions against the CURRENT major (Next 16: `proxy.ts`, not `middleware.ts`).

## Project overview
Pulse is the Strapi team's internal, single-instance tool for tracking sentiment across social mentions, capturing the full response trail (who replied, what was said, how it landed), and turning recurring signals into product decisions. Mentions arrive via an Octolens webhook; Pulse computes sentiment and topics (human-correctable), drafts AI answers grounded in official Strapi docs, notifies Slack with deep links, and exposes its data to AI clients through Strapi's official built-in MCP server. **Data collection is greenfield — fresh from launch, no migration.** One-liner: *the team's shared pulse on what the community feels — and proof our responses move the score.*

## Stack
- Backend / CMS: Strapi v5 **≥ 5.49.0**, Node ≥ 20, TypeScript
- Database: PostgreSQL (Strapi Cloud managed; SQLite for local dev only)
- Backend hosting: Strapi Cloud · Frontend: **Next.js 16** (App Router) on Vercel
- Auth: **stock Users & Permissions** (closed registration — admin-invited accounts; JWT in httpOnly cookie)
- AI: provider-agnostic interface in the `analysis`/`assistant` modules; v1 provider **Anthropic (Claude)**; draft grounding via the **Strapi docs MCP** consumed backend-side; daily token budget guard
- Search: **Postgres full-text** (no external search engine)
- Notifications: two Slack webhooks (team + ops) · Styling: Tailwind + shadcn/ui
- **Architecture principles**: heavy lifting in Strapi (thin, swappable frontend); modules as **Strapi-native `src/api/<name>` folders** (REVISED from local plugins during build — single instance, no admin-UI/distribution need); reference repos define binding conventions, no code imported

## Repo layout
```
pulse/
├── apps/
│   ├── cms/                      # Strapi v5
│   │   └── src/api|mcp/          # modules as api folders: ingest, analysis, assistant, notify + src/mcp (app-level tools)
│   └── web/                      # Next.js 16 (App Router)
├── package.json                  # workspaces
└── README.md
```

## Setup commands
```bash
# 1. Strapi backend (TypeScript is default; --quickstart is deprecated & conflicts with --dbclient)
npx create-strapi-app@latest apps/cms \
  --non-interactive --skip-cloud \
  --dbclient=postgres --dbhost=127.0.0.1 --dbport=5432 \
  --dbname=pulse --dbusername=postgres --dbpassword=postgres

# 2. Next.js 16 frontend
npx create-next-app@latest apps/web
cd apps/web && npm install @tanstack/react-query

```
Modules need no registration — `src/api/<name>` folders load natively. (REVISED from local plugins during build; see 04.)

## The Pulse score (single source of truth — implement once, use everywhere)
- Per **UTC day**: volume-weighted mean of `sentimentScore` over a **trailing 7-day window**, scaled 0–100 (`(mean + 1) × 50`). Computed overall and per topic/channel in the `insights` controller; the dashboard, digest, MCP tools, and chat all read this one implementation.
- Human-corrected scores participate like any other. A `modelVersion` change is annotated on the trend line like an Event (step-changes stay attributable). Historical mentions are never silently re-scored — re-scoring is an explicit, logged replay.

## Build order

### M1 — Strapi scaffold + Strapi Cloud project linked
- [ ] Scaffold as above; boots locally on Postgres (`npm run develop`)
- [ ] Create Strapi Cloud project at https://cloud.strapi.io, connect repo, root dir `apps/cms`, set env vars (below)
**Done when**: local boot works and `git push` deploys to Strapi Cloud.

### M2 — Content model
- [ ] Create the seven collection types + one component from the schemas below (draft & publish OFF everywhere)
- [ ] Seed `channel` rows (X, Reddit, LinkedIn, …) matching Octolens platform keys
**Done when**: all types visible in admin; an admin can create Events/Topics/Channels.

### M3 — Auth (stock Users & Permissions, closed registration)
- [ ] Disable public registration (Admin → Settings → Users & Permissions → Advanced) — accounts are admin-created
- [ ] **Seeding trap — both halves:**
  - Users seeded via the **U&P user service** — `strapi.query('plugin::users-permissions.user').create()` stores the password **unhashed** and login fails
  - Permissions: a fresh Strapi denies every action for BOTH roles — logged-in grants nothing. Each permission is its own record; admin-UI clicks don't survive a fresh DB. Seed in bootstrap:
```ts
const auth = await strapi.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } })
for (const action of [
  'api::mention.mention.find', 'api::mention.mention.findOne',
  'api::mention.mention.claim', 'api::mention.mention.route', 'api::mention.mention.draft',
  'api::mention.mention.correct', 'api::mention.mention.replay',
  'api::response.response.find', 'api::response.response.create', 'api::response.response.outcome',
  'api::topic.topic.find', 'api::topic.topic.findOne',
  'api::event.event.find', 'api::event.event.findOne',
  'api::channel.channel.find', 'api::channel.channel.findOne',
  'api::activity.activity.find', 'api::activity.activity.findOne',
  'api::search.search.query',
  'api::insights.insights.trends', 'api::insights.insights.themes', 'api::insights.insights.stale',
  'api::assistant.chat.chat',
])
  await strapi.query('plugin::users-permissions.permission').create({ data: { action, role: auth.id } })
// Public role: seed NOTHING (ingest webhook uses auth:false + secret, not a Public permission)
// Dead letters: admin-panel only — no U&P permissions at all
```
**Done when**: an admin-created user can log in via `POST /api/auth/local` and read mentions; anonymous requests get 401/403 on everything.

### M4 — Ingest, analysis, notify (the backend loop)
- [ ] **`ingest` module** (`src/api/ingest`, route-only) — `POST /api/octolens/ingest`, route `config: { auth: false }`, controller: reject unless `x-pulse-secret` header equals `OCTOLENS_WEBHOOK_SECRET`; validate + normalize payload; **validation failure → create `dead-letter` record (raw + error) + ops Slack alert — never drop data**; dedupe on `externalId` (200 on duplicate — webhooks redeliver); create Mention via Document Service (`analysisStatus: 'pending'`, `status: 'unanswered'`, `raw` = payload); log `ingested` activity; return fast (NO AI work in-request)
- [ ] **`analysis` module** (`src/api/analysis`, service-only) — provider-agnostic interface (`AI_PROVIDER`/`AI_API_KEY`; v1 = Anthropic): `analyze(mention)` → sentimentScore/label + topic assignment (create Topic via Document Service if new), stamps `modelVersion` + `promptVersion`, **skips any field on a `humanCorrected` mention**; `draft(mention)` → answer grounded via the **Strapi docs MCP** (`STRAPI_DOCS_MCP_URL`); **token budget**: count daily spend in a store against `AI_DAILY_TOKEN_BUDGET` — warn ops Slack at 80%, at 100% halt re-cluster only (new-mention analysis always continues)
- [ ] **Cron** (`config/cron-tasks.ts`, `cron.enabled: true` in `config/server`):
  - `* * * * *` — sweep `analysisStatus: pending|failed` → analyze → `analyzed` → notify Slack (lead with `negative`; every message deep-links `<PULSE_APP_URL>/mentions/<id>`). **Sweep errors → ops Slack**
  - `0 3 * * *` — topic re-cluster + themes rollup (never touches `humanCorrected`; skipped when budget exhausted)
  - `0 9 * * 1-5` — stale digest to Slack: unanswered/claimed older than `STALE_AFTER_DAYS` (default 2)
  - `0 0 * * *` — reset the daily AI token counter
- [ ] **Custom workflow routes** (all authenticated; server-set fields NEVER read from the body — stamped in the controller via the Document Service; naive body injection 400s in v5). Every transition also writes an `activity` record (who/what/when):
  - `POST /api/mentions/:documentId/claim` → `owner = ctx.state.user.id`, `status: 'claimed'`
  - `POST /api/mentions/:documentId/route` → set `suggestedTeam` and/or `assignee` (validated user id); Slack-ping the assignee with a deep link
  - `POST /api/mentions/:documentId/correct` → human override of sentiment/topics; `humanCorrected: true`; activity records before/after
  - `POST /api/mentions/:documentId/replay` → re-run stored `raw` through analysis (respects `humanCorrected`); also used to retry dead letters
  - `POST /api/mentions/:documentId/draft` → returns `{ draft }` (not persisted)
  - `POST /api/responses` → create Response, stamp `respondedBy`/`respondedAt`, parent mention → `status: 'answered'`
  - `PUT /api/responses/:documentId/outcome` → write `shared.outcome`; `result: 'resolved'` → mention `status: 'resolved'`
  - `GET /api/search?q=…` → **Postgres full-text** over mention content + response finalText/notes (tsvector; raw query in the controller)
  - `GET /api/insights/trends` (the Pulse score + event/model-version annotations) · `GET /api/insights/themes` (ranked recurring themes with evidence ids) · `GET /api/insights/stale?days=N`
- [ ] Disable auto-generated `POST/PUT/DELETE /api/mentions` for every role (mentions mutate only via webhook + workflow routes); `activity` and `dead-letter` are system-written only
- [ ] **Populate middleware** — file path must match the UID: `src/api/mention/middlewares/populate-mention.ts` → `api::mention.populate-mention` (a file in `src/middlewares/` is `global::` and silently never loads). Populate `channel`, `topics`, `owner`/`assignee` (id, username), `responses` (+ `outcome`), recent `activities`
- [ ] **Topic slug** — uid fields are NOT auto-filled on API/seed writes: generate `topic.slug` in Document Service middleware (`strapi.documents.use()` in `register()`)
- [ ] **Lifecycle hooks: none** — no request context, double-fire on publish; use the layers above
**Done when**: a signed webhook POST creates a mention (a malformed one creates a dead letter + ops alert); within a minute the cron analyzed it and Slack pinged with a working deep link; claim → route(assignee ping) → correct → draft → respond → outcome all work and each shows in the activity log.

### M5 — Frontend (Next.js 16, `app/`)
- [ ] Routes: `/` queue (oldest-first, staleness flags, SearchBox, URL-state filters) · `/mentions/[id]` (detail, DraftPanel, RespondForm, OutcomeForm, CorrectionControls, ActivityTimeline) · `/trends` (Pulse score chart + event/model annotations) · `/themes` · `/chat` · `/sign-in` · `/settings` (deep-links into Strapi admin)
- [ ] RSC fetches forward the JWT cookie; TanStack Query for client mutation state (claim, respond, correct, chat) via one shared client helper. **No queue polling** — post-mutation freshness is `router.refresh()`; add polling only if the team asks for it
- [ ] **Empty states designed for the greenfield early weeks** (sparse data must not look broken)
**Done when**: the queue renders live data for a signed-in user; search returns results; a correction round-trips.

### M6 — Auth UI
- [ ] `/sign-in` → `POST /api/auth/local` via a Next route handler setting the JWT in an **httpOnly cookie**; middleware guards all routes; sign-out clears the cookie
- [ ] Password reset is admin-performed in v1 (no email provider — conscious tradeoff)
**Done when**: unauthenticated visitors only ever see `/sign-in`; login/logout round-trips work.

### M7 — Assistant, MCP server, seed data
- [ ] **`assistant` module** (`src/api/assistant`) — `POST /api/assistant/chat`: `{ messages }` → data-grounded answer/report (queries mentions/trends/themes via Document Service; same AI provider interface + budget counter)
- [ ] **MCP** — `config/server.ts`: `mcp: { enabled: true }` (endpoint `POST /mcp`). **Auth (verified on 5.51): `/mcp` only accepts Admin Tokens (`kind: admin`), created via `POST /admin/admin-tokens` with `adminPermissions` drawn from the admin RBAC registry — e.g. `{ action: 'plugin::content-manager.explorer.read', subject: 'api::mention.mention' }`. Classic content-API tokens (Settings → API Tokens) are rejected with "Authentication required".** Create a read-only reporting token scoped to mention/topic/event reads. Register custom tools app-level in `src/index.ts` `register()` (tool definitions in `src/mcp/tools/*.ts`; a plugin is optional) via `strapi.ai.mcp.registerTool({ name, description, auth: { policies: [...] }, resolveInputSchema, resolveOutputSchema, createHandler })` — tools must declare CASL `auth.policies` (or `devModeOnly`); the gate passes when the token's ability satisfies ANY policy. MCP limitations: no media upload; stateless POST-only
- [ ] **Seed (dev/demo only — production starts empty by design)**: 3+ team users (via U&P service — hashed passwords), channels, a dozen topics, 2-3 events, ~50 mentions across sentiments/statuses with activities, responses with outcomes, one dead letter
**Done when**: Claude Desktop connected to `POST /mcp` with the read-only token runs `pulse.trend-summary`; `/chat` answers "top negative themes this month?" from seeded data.

### M8 — Deploy + smoke test
- [ ] Backend → Strapi Cloud (env vars below; Node ≥ 20); frontend → Vercel (root `apps/web`); **confirm DB backups are active on the chosen Strapi Cloud plan** (mentions are unrecoverable once platforms delete them)
- [ ] CORS: `strapi::cors` origin = the Vercel URL (no `*`)
- [ ] Point Octolens webhook at `https://<cloud-url>/api/octolens/ingest` with the shared secret; verify a malformed test payload dead-letters + alerts
- [ ] Smoke: real mention → analyzed + Slack deep-link ping → claim → correct → draft → respond → outcome → visible in trends + activity log
**Done when**: all acceptance criteria pass against deployed URLs.

## Strapi schemas (`schema.json`, Content-Type Builder format)

`apps/cms/src/api/mention/content-types/mention/schema.json`:
```json
{
  "kind": "collectionType",
  "collectionName": "mentions",
  "info": { "singularName": "mention", "pluralName": "mentions", "displayName": "Mention" },
  "options": { "draftAndPublish": false },
  "attributes": {
    "externalId": { "type": "string", "required": true, "unique": true },
    "content": { "type": "text", "required": true },
    "authorHandle": { "type": "string" },
    "url": { "type": "string" },
    "postedAt": { "type": "datetime" },
    "receivedAt": { "type": "datetime" },
    "channel": { "type": "relation", "relation": "manyToOne", "target": "api::channel.channel", "inversedBy": "mentions" },
    "sentimentScore": { "type": "decimal" },
    "sentimentLabel": { "type": "enumeration", "enum": ["positive", "neutral", "negative"] },
    "analysisStatus": { "type": "enumeration", "enum": ["pending", "analyzed", "failed"], "default": "pending" },
    "status": { "type": "enumeration", "enum": ["unanswered", "claimed", "answered", "resolved"], "default": "unanswered" },
    "owner": { "type": "relation", "relation": "manyToOne", "target": "plugin::users-permissions.user" },
    "assignee": { "type": "relation", "relation": "manyToOne", "target": "plugin::users-permissions.user" },
    "suggestedTeam": { "type": "enumeration", "enum": ["devrel", "marketing", "product"] },
    "topics": { "type": "relation", "relation": "manyToMany", "target": "api::topic.topic", "inversedBy": "mentions" },
    "humanCorrected": { "type": "boolean", "default": false },
    "modelVersion": { "type": "string" },
    "promptVersion": { "type": "string" },
    "responses": { "type": "relation", "relation": "oneToMany", "target": "api::response.response", "mappedBy": "mention" },
    "activities": { "type": "relation", "relation": "oneToMany", "target": "api::activity.activity", "mappedBy": "mention" },
    "raw": { "type": "json" }
  }
}
```

`response`: `mention` (manyToOne, inversedBy `responses`) · `draftText` (text) · `finalText` (text, required) · `respondedBy` (manyToOne → `plugin::users-permissions.user`) · `respondedAt` (datetime) · `notes` (text) · `outcome` (component `shared.outcome`). D&P off.

`topic`: `name` (string, required, unique) · `slug` (uid → name) · `kind` (enum: feature/bug/docs/competitor/other) · `description` (text) · `mentions` (manyToMany, mappedBy `topics`). D&P off.

`event`: `title` (string, required) · `date` (datetime, required) · `kind` (enum: release/launch/incident) · `notes` (text). D&P off.

`channel`: `name` (string, required, unique) · `key` (string, required, unique) · `url` (string) · `mentions` (oneToMany, mappedBy `channel`). D&P off.

`activity` (system-written): `mention` (manyToOne, inversedBy `activities`) · `actor` (manyToOne → U&P user, null = system) · `action` (enum: ingested/analyzed/claimed/routed/corrected/answered/resolved/replayed) · `detail` (json) · `at` (datetime). D&P off.

`dead-letter` (system-written, admin-panel only): `raw` (json) · `error` (text) · `receivedAt` (datetime) · `resolved` (boolean, default false). D&P off.

`shared.outcome` (component): `result` (enum: resolved/positive-turn/no-reaction/escalated) · `notes` (text) · `recordedAt` (datetime).

## API surface
See M4 for the custom-route table. Auto-REST used: `GET /api/mentions(+/:documentId)`, `GET /api/topics|events|channels|responses|activities` — all Authenticated-only; **no Public content access**; mention auto-mutations disabled for all roles; `activity`/`dead-letter` system-written only. Population via `api::mention.populate-mention` route middleware. No GraphQL.

## Auth
- Stock U&P, closed registration, admin-invited accounts, email/password → JWT
- Next.js keeps the JWT in an httpOnly cookie (set by a route handler at sign-in); RSC/SSR fetches forward it; middleware redirects signed-out users to `/sign-in`
- Roles: `Authenticated` = team member (M3 action list). Future roles = new U&P role + permission flips, no schema change. No `is-owner` policy in v1 (deliberate — high-trust internal team)

## Frontend route/page tree (Next.js 16, `app/`)
```
apps/web/app/
├── layout.tsx               # shell, nav, session provider
├── page.tsx                 # queue: oldest-first, staleness flags, search box, URL-state filters
├── mentions/[id]/page.tsx   # detail + draft + respond + outcome + corrections + activity timeline
├── trends/page.tsx          # Pulse score chart + event/model-version annotations
├── themes/page.tsx          # recurring-themes product feed
├── chat/page.tsx            # assistant chat (client, TanStack Query)
├── settings/page.tsx        # deep-links into Strapi admin
└── sign-in/page.tsx
```

## Environment variables

### Strapi (apps/cms)
- `DATABASE_URL`, `APP_KEYS`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` — Strapi Cloud injects
- `OCTOLENS_WEBHOOK_SECRET` — shared secret required by the ingest route
- `AI_PROVIDER` = `anthropic` (v1) · `AI_API_KEY` — provider-agnostic interface
- `AI_DAILY_TOKEN_BUDGET` — daily token cap (warn 80% → ops; halt re-cluster at 100%)
- `STRAPI_DOCS_MCP_URL` — Strapi docs MCP endpoint for draft grounding
- `SLACK_WEBHOOK_URL` — team channel · `SLACK_OPS_WEBHOOK_URL` — ops channel
- `PULSE_APP_URL` — deployed frontend URL for deep links in every Slack message
- `STALE_AFTER_DAYS` — SLA threshold (default 2)

### Frontend (apps/web) — Next.js public prefix is `NEXT_PUBLIC_`
- `NEXT_PUBLIC_STRAPI_URL` — public Strapi URL (browser-safe)
- No `STRAPI_API_TOKEN`: every fetch is per-user JWT; no anonymous content exists. If a public page is ever added, introduce an **unprefixed** server-only token then.

## Deployment
- **Backend → Strapi Cloud**: https://cloud.strapi.io → connect repo (root `apps/cms`) → env vars above → deploy on push. Docs: https://docs.strapi.io/cloud/getting-started/intro. U&P needs no extra auth env vars beyond the auto-injected `JWT_SECRET`. **Verify backups on the chosen plan.**
- **Frontend → Vercel**: import repo (root `apps/web`), set `NEXT_PUBLIC_STRAPI_URL`, deploy
- **CORS**: `config/middlewares.ts` `strapi::cors` origin = the Vercel URL (no `*`)
- **Octolens**: point the webhook at the deployed ingest URL + secret

## POC acceptance criteria (the core loop, deployed)
- [ ] A webhook-delivered mention appears in the queue with sentiment + topics within ~1 minute; Slack was pinged with a deep link that opens the mention
- [ ] A malformed webhook payload creates a dead letter and an ops alert — nothing is silently dropped
- [ ] A teammate claims a mention, corrects a wrong sentiment label (correction survives the nightly re-cluster), generates a docs-grounded draft, records the manual reply, records the outcome — status walks `unanswered → claimed → answered → resolved`, and every step shows in the activity timeline with who/when
- [ ] Routing a mention to a specific teammate pings them in Slack
- [ ] `/trends` shows the Pulse score with event annotations; `/themes` ranks recurring topics with evidence; a stale unanswered mention appears flagged in the queue and in the weekday digest
- [ ] `/api/search?q=` finds a known past response by its text
- [ ] `/chat` answers a natural-language question about the data
- [ ] Claude Desktop, connected to `POST /mcp` with the read-only token, runs `pulse.trend-summary` successfully
- [ ] Anonymous requests reach nothing but `/sign-in` and the secret-gated webhook

## Open questions / parked items
- Octolens pull/list API for gap reconciliation after webhook downtime (dead-letter replay is the fallback)
- Social-provider integrations to auto-post replies — future phase (v1 is draft + manual reply + record)
- External queue service to replace the cron sweep at higher volume
- kapa.ai as an external grounding layer when the app is consumed from Claude Desktop
- Email provider (unlocks self-serve password reset)
- Deferred consciously: ingest rate limiting · CSV export · staging environment · automatic outcome detection · data retention policy (no auto-deletion in v1)

## Revisions
- **2026-07-27 — Competitor handling & manual topics.** Mention `status` gains `acknowledged` (+ `acknowledgeReason`: competitor / not-relevant / watching) via `POST /api/mentions/:documentId/acknowledge` — deliberate close without a public reply; keeps full analytics value (trends/themes key off `analysisStatus`). Response gains `internal: boolean` — internal-only commentary that never flips the mention to `answered` (activity action `noted`), searchable through the existing response search. Octolens competitor signal (`tags: ["competitor_mention"]`, `keywords[].keywordTag: "competitor"`) auto-creates/attaches `kind: competitor` topics at intake (e.g. `#Payload`). The labeling panel can mint new topics inline (server-side create inside the `correct` action — `topic.create` stays unexposed). Queue gains a status filter row and always shows the posted date (the red "Nd old" chip remains the 2-day SLA flag, not a date).
- **2026-07-27 — Shared tool registry (MCP ⇄ in-app assistant).** All AI-facing tools live once in `apps/cms/src/tools/registry.ts` (name/description/zod schema/handler) and are consumed by BOTH surfaces: the built-in MCP server (`src/mcp/index.ts` loops the registry; read tools gated by content-manager read policy, write tools by update policy) and the in-app assistant (`api::assistant.answer` is now a Claude API tool-use loop over `anthropicTools()` — zod v4's `z.toJSONSchema` bridges the schemas). Six tools: `pulse-queue`, `pulse-get-mention`, `pulse-save-draft` (write), `pulse-search-mentions`, `pulse-trend-summary`, `pulse-theme-report`. Draft loop: agent saves `mention.draftText/draftedAt/draftedVia` (activity `drafted`) → queue shows a "draft ready" chip → reply form pre-fills the draft → recording the real reply consumes and clears it. Drafts are never auto-posted. MCP tokens: `POST /admin/admin-tokens` with content-manager read (+ update for save-draft) on mention/topic.
- **2026-07-27 — Per-tool MCP permissions in the admin panel.** Each registry tool now registers its own admin permission action in bootstrap (`admin::permission` actionProvider, section `settings`, category "Pulse MCP tools" → actionIds `api::pulse-mcp.<tool>`), and that action is the tool's ONLY auth policy — so tools are granted/revoked per token via checkboxes on the Admin Token screen (Settings tab), per the official pattern (strapi.io blog: extend MCP server with custom tools). Content-manager explorer permissions no longer gate tools. Migration note: existing admin tokens keep working only after granting the new actions (UI checkboxes, or PUT /admin/admin-tokens/:id with adminPermissions). Dev-mode caveat: watcher hot-restarts can run a stale dist — a full `strapi develop` restart is needed for bootstrap-registered actions to appear.
- **2026-07-28 — Granular Octolens plugin admin permissions.** The plugin's server bootstrap registers two admin permission actions (`section: 'plugins'`, `pluginName: 'octolens'` → `plugin::octolens.settings.read`, `plugin::octolens.sync.start`), same official pattern as the MCP tools. Admin routes now gate via `admin::hasPermissions` (status → settings.read, sync → sync.start); the menu link and homepage widget carry the read permission so they hide for roles without it. `sync.start` deliberately differs from the content-api U&P string `plugin::octolens.sync.trigger` to keep the two registries unambiguous. Grant per role under Settings → Roles → Plugins → octolens (Super Admin gets all actions implicitly).
- **2026-07-28 — Staleness measured from postedAt.** The "Nd old" SLA flag, queue/needs-attention ordering, and the stale digest all key off `postedAt` (when the comment was published on its platform, which Octolens provides) instead of `receivedAt` (when Pulse ingested it) — so synced backlog items that have gone unanswered for weeks flag immediately instead of looking fresh. `receivedAt` remains for ingest bookkeeping.
- **2026-07-28 — Timeline discussion: notes & comments (one flat collection).** New `api::comment.comment`: `kind` enum (`note` | `comment`, the only discriminator — user decision), `body`, `links` (json array of http(s) URLs, max 10, validated server-side), `author` (server-set), m2o to mention. Flat like chat — no nesting, ever. UI: the detail page's Activity rail became a unified **Timeline** (GitHub-issue pattern researched 2026-07-28): system events as compact muted lines, discussion as message cards — notes get an amber accent (Zendesk internal-note convention) and link-resource chips; composer at the bottom with a Comment/Note toggle. Discussion never changes workflow status. Supersedes the reply-form "internal note only" checkbox (removed; `response.internal` stays in schema for history/MCP compat). Comments are searchable (`/api/search` third result set) and appear in `pulse-get-mention` as `discussion`. Only `POST /api/comments` is exposed — reads go through the mention populate.
- **2026-07-28 — Own-comment edit/delete via is-owner middleware.** Route middleware `api::comment.is-owner` (adapted from PaulBratslavsky/strapi-tanstack-start-starter `server/src/middlewares/is-owner.ts` to this API's `author` relation) guards the core update/delete routes — users modify only their own comments/notes. Update controller whitelists `body`/`links`/`kind` (author + mention immutable) and stamps `editedAt` (explicit field — never inferred from updatedAt−createdAt, which is flaky). UI: pencil/trash on own cards, inline editor with link chips, two-step inline delete confirm (no browser dialog), "(edited)" indicator. Permissions seeded: comment update/delete. Trap fixed along the way: the Next proxy returned `new NextResponse('', {status: 204})` — 204 is a null-body status and even an empty string throws, so DELETEs 500'd; pass `null` for empty bodies. Top nav: sign-out is an icon button (LogOut) aligned with the avatar.
- **2026-07-28 — Comment soft delete + Strapi Pulse branding.** Comment DELETE is a soft delete: sets `archived: true` (never destroys — history stays in DB/admin); every read path filters `archived $ne true` (mention populate, search, MCP get-mention). Branding: official Strapi 2022 logo (extracted from @strapi/admin's bundled asset into `apps/web/public/strapi-logo.svg`) + "Strapi Pulse" wordmark in the top nav and sign-in.
- **2026-07-28 — Insights snapshot report + Strapi-blue theme.** New `GET /api/insights/snapshot?days=7|30|90` (service `api::analysis.insights.snapshot`, windowed on postedAt): totals + byStatus, answered count/rate, sentiment mix + avg score, top channels, acknowledged-by-reason, replies-by-teammate, median time-to-answer (respondedAt − postedAt, public replies only), Pulse score current + delta vs window start (reuses trends). Insights page renders it above the custom-reports placeholder: 7/30/90 URL-param filter pills, five stat tiles, a segmented sentiment bar (status colors, labels carry identity, 2px gaps), and two single-hue bar lists (teammate / channel) in Strapi blurple with direct labels. Theme: all rose/orange accents replaced app-wide with Strapi brand blurple (#4945FF → #7B79FF gradient).
- **2026-07-28 — Third discussion kind: `feedback`.** `comment.kind` enum is now note | comment | feedback — feedback captures the mention author's response / product insight (teal accent + FEEDBACK badge in the timeline; note stays amber, comment plain). Composer offers all three; validators updated on create/update. Timeline kind styling refactored into a single KIND_META config.
- **2026-07-28 — n/a sentiment label + always-visible age chip.** `sentimentLabel` enum gains `na` (stored enum-safe, displayed "n/a") for posts not about Strapi: correcting to n/a clears `sentimentScore`, so trends/Pulse score exclude it (they already skip null scores); own gray badge, queue filter chip, and Insights sentiment-mix bucket ("n/a (off-topic)"). Queue age chip is now always visible (Xh/Xd old, gray) and turns red only when the mention crosses STALE_AFTER_DAYS AND is still unanswered/claimed.
- **2026-07-28 — Duplicate-mention fix (three layers) + has-draft filter.** Root cause: Strapi v5 `unique: true` is enforced only by content-API validators — Document Service writes bypass it and NO DB index is generated, so the intake's findFirst→create pre-check raced under concurrent syncs (cron + manual Sync now). Fix: (1) bootstrap sweep `dedupeMentionsAndEnforceUnique` merges existing duplicates (keeps the row with responses/comments/owner/status value, deletes spares) then `CREATE UNIQUE INDEX IF NOT EXISTS` on mentions.external_id (SQLite + Postgres); (2) intake wraps create in try/catch — a lost race returns the winner's row; (3) sync service has an in-process overlap guard (concurrent runs skip with a log). Queue: "has draft" filter chip (`?draft=1` → `filters[draftText][$notNull]`). MCP-usage lesson: tokens should carry ONLY the Pulse MCP tool actions — content-manager read/update also exposes Strapi's generic document CRUD tools, which is how a mention body got overwritten from Claude Desktop.
- **2026-07-28 — Auth: 7-day sessions (deviation, flagged).** Users were signed out every ~10 minutes: `jwtManagement: 'refresh'` issues 600-second access tokens (docs default) while the Next app stores the JWT in a 7-day httpOnly cookie with no refresh loop. Decision: switch to `legacy-support` + `jwt.expiresIn: '7d'` so token and cookie lifetimes match — right-sized for an internal tool. Parked: reinstate refresh mode when the frontend implements token rotation (second httpOnly cookie for the refresh token, rotate in proxy.ts on 401, retry).
- **2026-07-28 — CRITICAL fix: MCP tool permission actions must register in register(), not bootstrap().** The admin plugin's bootstrap cleanup prunes token/role grants whose action isn't in the registry yet; app bootstrap runs after it, so every restart/deploy silently wiped the per-tool grants off admin tokens (verified: local token lost all six api::pulse-mcp.* grants; plugin-registered octolens actions survived because plugin bootstrap runs earlier). Registration moved to app register(); grants verified to survive restarts. Prod tokens need their Pulse MCP checkboxes re-checked ONCE after this deploy.
- **2026-07-28 — P0 batch from the architectural review (all six verified findings fixed, then adversarially re-verified).** (1) analysisSweep: reentrancy guard (same pattern as octolens sync), `analysisAttempts` retry cap (5) with ONE park alert; success and replay reset the counter. (2) Sync: per-mention error isolation — failures dead-letter (deduped per item via a `sync:<hash>` key so the 5-min re-walk can't spam rows) with one aggregated ops alert per run; malformed items recorded too; `truncated` flag + ops alert when MAX_PAGES caps a run; `url`/`authorHandle` → text (255-char validator was a poison-pill trigger). (3) Dedupe merge now RE-PARENTS the spare's responses/comments/activities to the keeper and carries owner/assignee/status; boot failure alerts ops (a partial failure previously self-bricked the index creation silently). (4) Slack flood gate: intake + sweep notify only for mentions posted within 6h (backfills stay quiet). (5) Outcome on an internal note no longer resolves the mention. (6) Queue filterUrl clearing fixed ('key' in over semantics) + e2e regression test (18 total). Intake reads the AI flag from api::analysis.ai.enabled() (single source of truth).
- **2026-07-28 — P1: workflow services (state machine + transactions) and race-safe topic/channel creation.** All workflow logic moved out of controllers into services: `api::mention` (claim/acknowledge/route/correct/replay) and `api::response` (record/recordOutcome). Each operation guards the transition (claim ← unanswered only; acknowledge ← unanswered|claimed; answer ← any status, re-opening acknowledged/resolved; resolve ← answered + public reply only) throwing `WorkflowError` (409/400/404 mapped in controllers via `sendWorkflowError`), and performs its writes inside `strapi.db.transaction` (Document Service joins the ambient trx — verified in @strapi/database: AsyncLocalStorage transactionCtx) with the activity logged atomically; Slack side effects stay outside the trx. Controllers are thin ctx adapters; future MCP/agent tools call the same service methods. Topic/channel creation centralized in race-safe `topic.ensure(names, kind)` / `channel.ensure(key, name)` ($eqi match + create-catch-refetch) used by intake, the AI sweep (was the exact-match outlier that duplicated 'docs'/'Docs'), and mention.correct. Boot constraints extended (each guarded individually + ops alert on failure): unique indexes on channels.key + topics.slug, hot-filter indexes mentions(status, posted_at), mentions(analysis_status, received_at), comments(archived). Live-verified guard matrix: claim×2 → 200/409, acknowledge from claimed → 200, ×2 → 409, reply on acknowledged re-opens → answered, resolve → 200, claim on resolved → 409.
- **2026-07-28 — P1 continued: list/detail populate profiles, webhook log hygiene, dead-letter replay.** populate-mention now serves two profiles: LIST (queue) populates channel/topics/owner/assignee + a filtered comment COUNT only — the full responses/activities/comments payload was being shipped 25× per page; DETAIL keeps the full shape (shapeMention + the queue chip handle both count/array forms). Webhook: `?secret=` is redacted from ctx.url before strapi::logger writes it (Octolens can't send headers, so the query param stays; it no longer lands in retained access logs) and the compare is `timingSafeEqual`. Dead-letter loop closed: `POST /api/dead-letters/:documentId/replay` (permission seeded) re-runs the stored raw through the SAME normalize+intake path (normalize moved from the webhook controller into `intake.normalizePayload`, shared by webhook + replay) and flips `resolved` on success — live-verified: malformed→400, valid→replayed+created, resolved→400.
- **2026-07-28 — Refactor hardening (from adversarial verification of the P1 diff).** (1) `topic.ensure()` race recovery now refetches by SLUG first — the unique index fires on slug, and distinct names collide to one slug ('Docs!' vs 'Docs'); non-latin names slugify to '' so both ensure() and the register() middleware fall back to a stable hex slug. (2) Transition guards are now race-proof, not advisory: status is re-checked INSIDE the transaction under a row lock (`trx('mentions').forUpdate()` — locks on Postgres, single-writer SQLite serializes) for claim/acknowledge/resolve. (3) recordOutcome refuses to overwrite an already-recorded outcome (409). Live-verified: double-claim 409, outcome-overwrite 409, slug-colliding new topic reuses the existing row.
- **2026-07-28 — P1: frontend consolidation.** One client (`lib/pulse-client.ts`: `pulseFetch` + `PulseApiError` carrying status) replaces six divergent inline fetch helpers; shared wire types in `lib/types.ts` (incl. `commentCount()` for the list-count vs detail-array shape). Shared atoms in `components/ui.tsx` (Avatar ×4 copies, UserChip ×3, FilterPill ×4, EmptyState) + `components/mutation-error.tsx` — every mutation now renders its failure (claim/genDraft/outcome/correct were silent). Timeline split from a 414-line monolith into `components/timeline/{index,system-entry,discussion-card,composer,link-list-editor,kind-meta,types}` — DiscussionCard owns its own edit/delete state (parallel state gone), LinkListEditor shared by composer + edit mode. Route-level `error.tsx` / `not-found.tsx` / `loading.tsx` added. 409-aware UX: claim and outcome refresh the page on conflict so a stale view self-corrects instead of failing silently.
- **2026-07-28 — Noise control: shadow-blocked authors + spam quality axis.** Real-data trigger: ONE AI content farm (`chase_neely_…`, all 27 posts carrying `LEXREF`/"autonomous AI agent" markers) was 13% of the real corpus and had pushed `#Webflow` to the top topic (65 → 55 after exclusion). New `api::muted-author` (handle unique, reason enum ai-spam/promo-spam/irrelevant/other, note, mutedBy, mentionCount) + `mention.quality` enum `normal|suspected-spam|spam`. **Deliberately a separate axis from `acknowledged`**: acknowledge KEEPS analytics value (competitor design), spam must leave the numbers entirely. Intake: muted author → `quality: spam` + auto-acknowledged + no Slack ping; conservative self-identifying heuristics (AI-disclosure markers, EU-AI-Act footers, LEXREF, netlify/vercel promo-link farms) → `suspected-spam` only (badge + review chip — silently hiding real feedback is worse than the slop). Exclusion applied to trends, themes, stale digest, snapshot, search, and the queue default; `?quality=spam|suspected-spam` chips review them. Mute is retroactive and reversible (unmute restores every mention). UI: mute button on queue cards, muted-author manager on Settings. **Trap fixed in the same change:** a schema `default` does NOT apply to existing rows and SQL `col != 'x'` is false for NULL — the first version silently hid all 501 legacy mentions from every analytic. Fixed with a boot backfill (`quality IS NULL → 'normal'`, 501 rows) plus NULL-safe `$or` filters, and a `mentions(quality)` index. 19 e2e.
- **2026-07-28 — Bulk triage (non-AI throughput) + retroactive spam rescan + no-topics filter.** Prod reality: 134 unanswered vs 5 answered, with ~30/day arriving — one-at-a-time triage can't keep up, and this is the keyless workflow's real bottleneck (AI drafting deferred by user decision). `POST /api/mentions/bulk { action: acknowledge|claim|correct, documentIds[], ...payload }` runs the SAME guarded service methods per item — each in its own transaction with its own transition guard — and returns per-item results, so one illegal transition (e.g. re-acknowledging) can't sink the batch (verified: 3 succeeded, repeat → 3×409, batch intact). Max 200/call; `correct` ensures any new topics ONCE for the whole batch outside the per-item transactions. UI: checkbox per queue card + a sticky action bar (select-page, acknowledge with reason, mark n/a, claim, add topic) that only appears with a selection. `POST /api/muted-authors/rescan` applies the spam heuristics to existing mentions (intake only classifies new arrivals) — `spamSignals` exposed as an intake service method rather than a cross-package require (which 500s from compiled dist); verified 523 scanned → 1 flagged. New "no topics" queue filter surfaces the unlabeled backlog a bulk topic pass exists for. 20 e2e (bulk test backdates its fixtures so page-1 placement is deterministic).
- **2026-07-28 — Spec correction: TanStack Query's actual role.** Stages 5/6 claimed "queue polling" as its justification; polling was never implemented (flagged by the architecture review as an unlogged deviation). Its real jobs today: mutation state (`isPending`/`isError`) across 26 `useMutation` sites, and ONE cached query (the search box). Decision after review (2026-07-28): **keep it** — swapping to server actions + `useActionState` would rewrite 26 call sites for no user-visible gain, and `useActionState` fits poorly for non-form buttons, per-row pending state (timeline edit/delete) and the multi-action bulk bar. Auth intentionally uses the other idiom (server actions) because sign-in is a form submit with redirect semantics. Revisit only as part of removing the `/api/pulse` proxy hop entirely (server actions calling Strapi directly + `revalidatePath`), which is an architectural change, not a dependency swap.
- **2026-07-28 — Queue sort toggle (oldest ⇄ newest).** The queue was hard-coded `postedAt:asc` — correct for SLA pressure ("what has waited longest") but wrong for burning down a 134-item backlog or catching up on today's arrivals, with no way to flip it. `?sort=newest` → `postedAt:desc`; oldest stays the default (no param), the toggle sits beside Sync, and the subheading states the active order. URL-based like every other queue filter, so it composes with status/sentiment/topic/draft/quality/no-topics and survives sharing. 21 e2e (test injects one 2018-dated and one fresh mention and asserts each leads its ordering).
- **2026-07-28 — Triage keyboard shortcuts.** Gmail/Linear conventions over the bulk-triage layer: `j`/`k` (or arrows) move focus with a visible ring and scroll-into-view, `x` selects the focused card, `a` acknowledge / `c` claim / `n` mark n/a / `t` add the chosen topic, `o` or `Enter` opens, `Esc` clears, `?` toggles a help overlay. Actions apply to the **selection when there is one, else the focused card**, so a fast pass is `j x j x a` without touching the mouse. **Guard: shortcuts never fire while typing** (INPUT/TEXTAREA/SELECT/contentEditable, and any modifier held) — the global search box lives in the nav, so an unguarded listener would hijack every keystroke; the e2e test asserts typing `jjjxxx` into search selects nothing. Help is also reachable by clicking "keyboard shortcuts" in the queue hint (discoverable without knowing `?`). 22 e2e — the keyboard test reads the focused cards' `data-mention-id` from the DOM instead of assuming queue position, since shared dev data makes position unstable.
- **2026-07-28 — Dark-mode switcher (light / dark / system).** Tailwind v4 defaults `dark:` to `prefers-color-scheme`, which left users no way to override the OS. Switched to a class strategy — `@custom-variant dark (&:where(.dark, .dark *))` in globals.css, CSS variables moved from the media query to a `.dark` block — with a three-state toggle in the top nav (cycles light → dark → system, persisted in `localStorage['pulse-theme']`, and following OS changes live while on "system"). An inline pre-paint script in `layout.tsx` applies the stored theme before first render (`suppressHydrationWarning` on `<html>`), so dark-mode users never get a white flash on navigation; the toggle renders a neutral icon until mounted since the server can't know the stored preference. 23 e2e (asserts the class flips, localStorage persists, and the theme survives a full reload).
- **2026-07-28 — Bulk edit is a mode, not always-on.** A checkbox on every card is noise while reading the queue, so selection is now behind a **"Bulk edit"** toggle (button in the queue header, `b` from the keyboard); checkboxes render only in that mode and the button shows the live selection count. Pressing `x` turns bulk edit on implicitly, so the keyboard flow (`j x j x a`) still needs no clicks. Leaving bulk edit clears the selection deliberately — a hidden selection that still receives actions is a footgun. 23 e2e (asserts zero checkboxes until the mode is on, and that `x` enables it).
- **2026-07-28 — `npm run db:clean-e2e`.** The Playwright suite injects through the real webhook (deliberate — it exercises the true ingest path), so fixtures accumulate in the dev DB and bury real mentions (470 of 674 rows). Muting the e2e author would NOT work: a muted author's mentions are marked spam at intake and never reach the queue or search, which is exactly what four tests assert. Instead a cleanup script deletes rows whose `externalId` starts with `e2e-` (unambiguous — the helper always generates that prefix) plus their responses/comments/activities and topic links. Local SQLite only; never run against production.
