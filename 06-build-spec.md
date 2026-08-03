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
- **2026-07-28 — Draft is a suggestion, not a prefill.** The reply form rendered a saved draft twice — once as a preview block, once prefilled into the textarea — making the form enormous and blurring "what was suggested" with "what I actually sent" (the recorded `finalText` is the audit record of the real reply, so that distinction matters). Now: the draft is a **collapsed accordion** (`Draft ready · via <source> · N chars — click to read`, same `<details>` idiom as the timeline's answered entries) with a **"Use this draft"** button that copies it into the reply box on demand; the textarea always starts empty, and AI-generated drafts no longer auto-fill it either. 24 e2e (asserts never-prefilled on a fresh mention, and — on a mention that has a draft, found via the has-draft filter — that the accordion renders and the button fills the box).
- **2026-07-29 — `own-post` acknowledge reason (+ excluded from sentiment metrics).** Flagged from a live MCP session: Strapi's own social/marketing posts land in the queue via keyword monitoring, and the only honest-ish close was `not-relevant` — which is false (they're highly relevant, just not repliable) and made the acknowledged pile unreadable. `acknowledgeReason` gains **`own-post`** (schema, service guard, both UI reason pickers, and the `pulse-acknowledge` MCP tool with description text telling agents to prefer it over `not-relevant`). Second, unflagged problem fixed at the same time: our own announcements are **positive by construction**, so counting them inflated our own Pulse score — the analytics filter now excludes `own-post` alongside spam (`trends`, `themes`, `stale`, `snapshot`). They stay visible in the acknowledged pile: excluded from the numbers, not hidden from the team. Verified live: acknowledge → 200, and the snapshot's `acknowledgedByReason` no longer counts it.
- **2026-07-29 — Mute author from the mention detail page.** The mute action existed only on queue cards, but the detail view is where the decision actually gets made — you read the post, conclude it's promotional, and previously had to navigate back to the queue (or Settings) to act. `MuteAuthorButton` now sits in the detail action row, available at any workflow status (unlike Acknowledge, which is unanswered/claimed only), and a muted author's mention shows an `author muted` chip in its place. The e2e shadow-block test now mutes from the detail page and asserts the chip, then checks the Settings list — covering the full path a person actually takes.
- **2026-07-29 — Team leaderboard ("This week") in the right rail.** `GET /api/insights/leaderboard?days=7` (service `api::analysis.insights.leaderboard`) counts per-user activity from the **activity trail** — so it stays honest whether work happened in the UI, via bulk actions, or through MCP. **Ranked by replies posted, deliberately NOT by triage volume:** a board that scores acknowledges would reward mass-dismissing the queue, the exact opposite of the behaviour the tool exists to encourage. Triage and resolved counts appear as an aggregate footnote for context, never as rank. Rolling 7-day window so it resets weekly instead of calcifying into a permanent winner; medals for the top three, avatars, and a "No activity yet — be first." empty state. 25 e2e (asserts the board renders and that recording a reply credits the signed-in user).
- **2026-07-29 — Leaderboard tuned for encouragement, not surveillance (user directive).** Three changes after the first cut read as a performance record: (1) **nobody appears with a zero** — only people who posted ≥1 reply are ranked, so a quiet week is absent rather than publicly last; (2) whoever kept the queue moving is **named but never ranked** ("🧹 Also keeping the queue moving: paulbrats") — erasing triage because it isn't a reply was the discouraging bug in the first version; (3) the headline is **collective** ("The team posted 14 replies in the last 7 days"), with triage/resolved as team totals marked "counted for the team, not ranked". Participation is **opt-out, default on**: new `api::preference` content type (deliberately its own type — a partial U&P user extension silently replaces the base schema and drops email/password) with self-scoped `GET/PUT /api/preferences/me` and a Settings toggle; opting out removes you from the list while your work still counts in the team total.
- **2026-07-29 — Feedback page (`/feedback`, nav item).** `GET /api/insights/feedback?days=&topic=` surfaces every `kind: feedback` timeline entry with its source mention (excerpt, author, channel, sentiment, topics, links out), newest first, plus topic counts as the prioritisation signal. Reads **human-captured** feedback rather than raw mention text on purpose: the team's framing of a pain point beats a keyword match, and everything listed was judged worth capturing by a person. Archived comments and spam mentions excluded; 30d/90d/1y windows and clickable topic filters.
- **2026-07-29 — "mentions Strapi" queue filter.** Most of the queue arrives via competitor keyword monitoring and never names Strapi. `?q=<text>` → `filters[content][$containsi]`, exposed as a one-click chip so triage can cut to posts that are actually about us. 27 e2e.
- **2026-07-29 — "Team celebration" replaces the leaderboard framing (user directive, supersedes the tuning entry above).** Team decision: **everyone with any activity is listed, replies shown even at zero** — this team isn't judged on reply count, and the earlier "also keeping the queue moving" line read as a consolation prize. **No medals, no rank numbers**: it's a contribution list, not a competition. Section renamed to **Team celebration 🎉** with a collective headline first ("Last 7 days: 16 replies · 14 resolved · 94 triaged"), then each person's replies and triage count. Opting out (Settings → Team celebration, default on) remains the escape hatch for anyone who'd rather not appear, and their work still counts in the team totals. Sorted by replies then triage purely for stable ordering.
- **2026-07-29 — Celebration shows named categories; feedback gets product-area tags; manual spam flag.** (1) The celebration panel replaced one opaque "N triaged" number with **named, non-zero-only categories** (replies · acknowledged · resolved · labeled · drafts · notes · claimed) for both the team headline and each person — "49 triaged" told nobody what the week looked like, and "0 resolved" was noise. (2) **Feedback tags:** `comment` gains its own `topics` m2m (product areas like "visual editor", "admin panel") — deliberately a different axis from the mention's topics, which come from competitor keyword matching, so a pile of #Webflow can't masquerade as a prioritisation signal. Tag input appears in the composer for `feedback` only (quick comments stay frictionless), tags reuse the shared vocabulary via race-safe `topic.ensure`, and `/feedback` groups + filters by them. (3) **Possible-spam flag:** `POST /mentions/:documentId/quality` sets normal | suspected-spam | spam with an activity entry; button sits next to Mute author on both the queue card and the detail page (mute stays the stronger action — retroactive and forward-looking), badge added to the detail header, and `pulse-update-mention` gained a `quality` field so agents can flag from MCP. 28 e2e — several tests rewritten to scope the queue with `?q=<tag>` so accumulated dev fixtures can't push them off page 1, and the rail assertion now pins a wide viewport and scrolls the row into view instead of skipping.
- **2026-07-29 — Celebration panel as icon chips.** The word-per-category sentence ("31 replies · 85 acknowledged · 21 resolved · 41 labeled…") could not fit a 330px rail: it wrapped over three lines and truncated usernames to "pa…". Replaced with **icon + number chips** (↩ replies · 👁 acknowledged · ✓ resolved · 🏷 labeled · ✎ drafts · 🗒 notes · ✋ claimed), the word carried in a `title` tooltip and an `sr-only` span so screen readers and hover still get the full label. Each person's name now sits on its own line with stats beneath, so names never truncate. Zeros stay hidden.
- **2026-07-29 — Dismissable action panels.** The labeling and acknowledge panels opened from a toggle button but offered no way out except re-clicking that button — easy to miss once the panel has pushed it up the page. Both now carry an **X** in their header (`aria-label` "Close without saving" / "Close without acknowledging") and close on **Escape**. Nothing is written until the explicit action button, so dismissing is always safe. 29 e2e (asserts closing leaves no human-corrected flag and no status change).
- **2026-07-29 — Celebration shows three stats, not seven.** Seven icon chips per row was still visually busy in a 330px rail. Reduced to **replies · acknowledged · triaged**, where `triaged` is a service-side rollup of resolved + labeled + notes + drafts + claimed + routed. The detailed per-category counts stay in the API response for future breakdowns (a fuller view on the Insights page, say) — only the rail simplifies.
- **2026-07-29 — Insights tiles: four, not six.** `answered` / `resolved` / `acknowledged` are three slices of one question ("did we close it out?"), so they collapse into a **Handled** tile with the split on the detail line and the acknowledge reasons in the tooltip; zero slices drop out instead of spending a whole tile on `0`. Labels were shortened until none wrap, which is what puts every number on the same baseline — the old `min-h` label spacer is gone. Pulse score leads, accented, with its delta inline.
- **2026-07-29 — Celebration rows are one line, column-aligned.** Team totals and each teammate share one fixed grid template (`avatar · name · 3 stat columns`), so the icons line up down the panel. Zero stats render an empty cell rather than a `0` — alignment without noise. Icons: chat bubble for replies (public replies, not email), open eye for acknowledged ("we saw it", not "we hid it").
- **2026-07-29 — Empty-state placeholders span the content column.** `/chat` and `/settings` had `max-w-2xl` / `max-w-3xl` wrappers that left the dashed box floating in a half-width column; the wrapper constraint is gone and only the inner copy stays measure-limited.
- **2026-07-29 — Spam judgements carry a rationale, and agents can't confirm them.** Added `qualityReason` (text, ≤500) and `qualityVia` (`app` | `mcp` | …) to Mention. A flag that can't say *why* forces whoever confirms it to re-judge from scratch and leaves no way to audit whether a rubric is any good. Clearing back to `normal` nulls both, so a stale rationale never outlives the flag it explained. The MCP `pulse-update-mention` enum is narrowed to `normal | suspected-spam` — terminal `spam` hides a mention from the queue *and* every analytic, so confirming it stays a human action in the app; an agent misfiring across a batch would otherwise silently erase those mentions from the metrics.
- **2026-07-29 — Trend-chart event labels stack in lanes.** All markers printed at one `y`, so two events a week apart overlapped into unreadable text. Labels now walk left-to-right and drop a lane whenever they'd start before the previous occupant ends; labels near the right edge anchor on the other side of their line so they stay inside the plot.
- **2026-07-29 — Agents can read the spam state they write.** `pulse-get-mention` now returns `quality` / `qualityReason` / `qualityVia`, and `pulse-queue` / `pulse-search-mentions` surface `quality` when it's set (omitted when `normal`, to keep payloads small). Without this an agent could write a flag but never see one: it couldn't verify its own write, couldn't tell an already-judged mention from a fresh one, and would re-judge the whole corpus on every sweep. **Trap:** Document Service `findMany` with an explicit `fields` array silently returns `undefined` for anything not listed — adding the key to the response object isn't enough, it has to be in `fields` too. That bit twice in one sitting.
- **2026-07-29 — Queue-filter test no longer depends on page 1.** Every run backdates its fixtures to the same instant (`2017-03-01`), so once 25+ mentions tied on `postedAt` — page size is 25 — which ones landed on the first page became arbitrary and the test failed on accumulated data rather than on a defect. It now scopes by the run's own tag. Note `?q=` is a single `$containsi` substring, not an AND of terms, so the Strapi discriminator is embedded in the tag token (`<tag>strapi` vs `<tag>other`) to make narrowing testable with one substring.
- **2026-07-29 — `suspected-spam` is excluded from the metrics immediately, not on confirmation.** The analytics filter now excludes both `spam` and `suspected-spam` (`$notIn`), because waiting for a human left flagged content doing the exact damage the flag exists to stop — five near-identical farm posts were still setting the Pulse score. A flag now takes effect at once; clearing to `normal` restores the mention to every metric. Verified reversible: `603 → 602 → 603`. Flagged mentions stay in the **queue** (that's how they get reviewed) — this is a metrics exclusion, not a hide. **Deliberate exception:** the feedback digest still excludes confirmed `spam` only, because feedback is insight a teammate chose to write down and an unconfirmed machine flag shouldn't delete human work from the prioritisation view. **NULL-safety:** SQL `col NOT IN (…)` is FALSE for NULL, so the `$null` arm is required or legacy rows predating `quality` vanish from every metric.

## Responsive / mobile (2026-07-30)

Pulse is used from phones during triage, so the app is verified at real device
metrics, not just a narrow desktop window.

- **Phone navigation.** The left sidebar is `max-sm:hidden`, which meant a phone
  could reach *nothing but the queue* — Trends, Themes, Feedback, Insights, Chat
  and Settings were all unreachable. Added a drawer behind a hamburger in the top
  bar: closes on navigation, on Escape, and on backdrop tap; locks body scroll
  while open (iOS otherwise scrolls the page underneath) and returns focus to the
  trigger on close. A drawer rather than a bottom tab bar because there are seven
  destinations — five would fit a tab bar, seven would not.
- **Viewport + safe areas.** Explicit `viewport` export with `viewportFit: 'cover'`
  plus `env(safe-area-inset-*)` padding on the fixed top bar and the sticky bulk
  bar, so nothing sits under the notch or the home indicator. `themeColor` tints
  browser chrome per scheme.
- **`dvh`, not `vh`.** Mobile Safari's `100vh` includes the retracting URL bar, so
  full-height panes jumped as it hid. All shell heights use `dvh`.
- **iOS zoom-on-focus.** Safari zooms in whenever a focused field is under 16px
  and never zooms back out; the app is full of `text-sm`/`text-xs` inputs, so
  every search or reply tap jolted the layout. One `@media (max-width: 639px)`
  rule in `globals.css` sets fields to 16px — the compound `:not()` selector is
  deliberate, to outrank Tailwind's single-class utilities without `!important`.
  Checkboxes/radios exempt. Guarded by a test that fails on any sub-16px field.
- **Touch targets.** Icon buttons are 44px on phones (iOS HIG / Android 48dp).
  Filter pills use a 38px floor rather than 44 — the queue stacks ~17 of them and
  44 would eat the screen; still comfortably tappable.
- **Overflow.** `min-w-0` on the content flex child (a long unbroken URL in a
  scraped mention would otherwise set the flex base size and push the whole page
  sideways), and the muted-authors row wraps instead of overflowing by 42px.

**Testing.** `e2e/responsive.spec.ts` runs under device projects. The
load-bearing assertion is "no horizontal scroll" on every page — the failure
users actually feel, and it catches a whole class of regressions no component
test would. **Known environment limitation:** the real WebKit projects
(`mobile-ios-webkit`, `tablet-webkit`) are gated behind `PW_WEBKIT=1` because
the `webkit-2336` build segfaults on launch under macOS 26 (Darwin 25). What
runs by default is iPhone/iPad *metrics on Chromium*, which covers overflow,
breakpoints and tap targets but **not** Safari's actual `dvh` /
`env(safe-area-inset-*)` behaviour. Enable `PW_WEBKIT=1` in CI or on a machine
with a working WebKit to close that gap.

## Conversation map (2026-07-30)

Pulse treated mentions as a queue to drain. The map treats them as a corpus: what
the community talks about, what travels together, and what nobody connects.
Obsidian is the interaction model, [InfraNodus](https://infranodus.com/docs/text-network-analysis)
the analytical one.

**Nodes come from mention TEXT, not the Topic relation** — the decision the whole
feature rests on. Measured before building: 687 of 1005 mentions carry no topic and
only 7 carry more than one, and a co-occurrence edge needs two topics on one mention.
A topic graph would have had ~10 edges. Verified after building: the `topics`
projection returns **0 nodes**, while `terms` returns 194 nodes / 1200 edges / 5
clusters. Term extraction is dependency-free and needs no AI, matching the current
posture.

**Extensibility** is a projection registry (`src/graph/projections.ts`), same shape as
`PULSE_TOOLS`: a descriptor with `id/label/description/build`. Three ship — `terms`
(concepts from text), `topics` (curated, ready for when the AI sweep runs), `authors`
(bipartite author↔concept). The endpoint, the MCP tool and the renderer are generic
over the wire format, so a fourth needs no change to any of them; the renderer keys
colour/size off `node.kind` via `KIND_STYLE`.

**Analysis runs server-side** (`api::analysis.graph`): Louvain clusters, betweenness
bridges, and structural gaps, TTL-cached so every viewer sees the same map and a phone
does no graph maths. Layout (ForceAtlas2) stays client-side because it has to be
interactive.

Traps hit while building, all now guarded:
- **Strapi services register from the DEFAULT export.** A named-only export compiles
  clean, registers nothing, and surfaces as `strapi.service(...)` being `undefined` at
  call time.
- **`graphology` ships no default export** — `import G from 'graphology'` is `undefined`
  under esModuleInterop and only fails at `new G()`, long after the module loaded fine.
- **Unbounded co-occurrence is a hairball**: 300 concepts produced 31,771 edges, which
  renders as a solid disc and collapses Louvain into one meaningless community. Capped
  to the heaviest `maxEdges`, reported via `truncated` rather than silently.
- **A bipartite projection needs a per-side node cap.** Ranked globally by weight,
  concept frequencies dwarfed every author and the graph collapsed to 4 nodes.
- Hot reload can register a route before its controller compiles (`Handler not found`);
  restart rather than debug it.

**`pulse-graph`** returns the *analysis* — clusters, bridges, gaps — never the node/edge
lists, which are useless to an LLM and would blow the ~950 KB doubled wire cap. Server
computes, agent interprets. Like every tool it needs its permission box checked before
a token can call it.

**Testing:** `e2e/graph.spec.ts` asserts the graph is **not near-empty** (>30 concepts,
>50 links) rather than merely that the page renders — a blank canvas would pass a
"loads" test and be worthless. `/graph` is in the `responsive.spec.ts` PAGES list, so
the no-horizontal-scroll invariant covers it on phone and tablet.

### MCP as the analysis step (2026-07-30)

With `AI_API_KEY` unset, topic assignment never runs — which is exactly why the
Topics map was empty. But an MCP client *is* the AI: Claude Desktop or Claude Code
can read mentions and assign topics through a tool call, no key required. Because the
registry feeds both surfaces, the same tool serves the in-app assistant the moment AI
is enabled — nothing to rewrite.

Two gaps blocked that and are now closed:
- **`pulse-queue` gained `topics: 'none'`** so an agent can *find* untagged work
  (mirrors the app's own `?topics=none` filter). 535 untagged locally.
- **`pulse-assign-topics`** (bulk, ≤40 mentions) — `pulse-update-mention` rejects
  unknown slugs, so an agent could reuse the topic vocabulary but never extend it.
  The new tool goes through `topic.ensure()` (case-insensitive, race-safe create),
  MERGES rather than replaces, and promotes `pending`/`skipped` → `analyzed` so a
  later AI run treats the work as done instead of overwriting it.

Verified end to end: four tool calls took the Topics map from **0 nodes to 12 nodes /
9 edges / 3 clusters** (Webflow, Bugs, Vendor lock-in).

That test also exposed a bug of mine: the global `minWeight` default of 3 was hiding
topic edges that already existed. Thresholds are now per projection
(`defaultMinWeight`) — mined text needs a high floor because noise pairs are
everywhere; a curated vocabulary needs 1, since a deliberate human tag is signal even
seen once.

### Local backend port 1338 (2026-07-31)

Port 1337 is the Strapi default, so every other Strapi project on the machine fights
for it — one such collision silently pointed Pulse's frontend at a different project's
database mid-session, and the e2e suite failed with "invalid credentials" until it was
traced. Pulse's backend now runs on **1338** (`apps/cms/.env`, all `NEXT_PUBLIC_STRAPI_URL`
fallbacks, the `wait-on` in the root `dev` script, e2e helpers, `.env.example`s and the
README). Local MCP connectors need the same change; the deployed Strapi Cloud URL is
unaffected.
- **2026-07-31 — Writes invalidate the graph cache.** The 10-minute TTL meant an agent
  could tag a batch, immediately ask for the map, and see its own work missing — which
  reads as the write having failed. `pulse-assign-topics` and quality/topic edits via
  `pulse-update-mention` now call `graph.invalidate()`. Verified by tagging one mention
  and reading the map in the next call: the affected cluster grew in the same sequence.
- **2026-07-31 — Muting closes the author's open mentions.** Two defects, one visible:
  the "Needs attention" rail queried `status=unanswered` with **no quality filter**,
  while the queue has always excluded confirmed spam — so muted authors kept surfacing
  in the one panel that asserts a human is needed. And muting only ever set
  `quality: 'spam'`, leaving posts `unanswered` forever: still counted as outstanding
  work. Mute now also closes **open** states (`unanswered`/`claimed`) as
  `acknowledged` + new `acknowledgeReason: 'spam'`; ingest uses the same reason for
  new arrivals (it previously mislabelled them `not-relevant`). Boot backfill repaired
  31 already-muted mentions.
  Two deliberate constraints: the auto-close logs activity with **actor null**, because
  acknowledging is a human judgement that shows in the trail and the celebration stats
  and crediting one person for 27 auto-closes would be a lie (the leaderboard skips
  actor-less events); and **only open states are touched**, so a reply someone already
  sent survives a mute. Unmute reverses only what the mute closed — a mention a human
  acknowledged as `competitor` stays closed. Verified by round-trip: an `answered`
  mention was untouched through both mute and unmute. Known limit: a `claimed` mention
  reopens as `unanswered` (prior status isn't stored).
- **2026-07-31 — Queue header shows the open count.** The filtered total (not the page)
  as a badge beside the heading, straight from the pagination meta — no extra query.

### Finding things once the vocabulary grew (2026-07-31)

The app was built when there were a dozen topics. At 100+ several surfaces broke down
at once:
- **Labeling panel** rendered every topic as a checkbox — an unusable wall that pushed
  Save off screen. Replaced with `TopicPicker`: search and create in ONE box, because a
  separate "new topic" field is how someone types "Documentation" when "Docs" exists and
  silently forks the vocabulary. Creation is only offered when nothing matches, using the
  same case-insensitive rule `topic.ensure()` applies server-side.
- **Themes** listed every topic unpaginated. Now search-as-you-type + kind filter +
  paging, filtered in memory (the ranked set is already loaded, so a Search button would
  be pure friction). Fixed a real bug while there: `view queue →` linked to
  `?sentiment=negative`, showing every negative mention regardless of which theme you
  clicked — it now filters by that topic.
- **Feedback** gained the same instant search, over the captured text, tags AND the
  source mention. Its tag chips cap at the top 8 with a `<details>` disclosure for the
  tail: the chips are ranked by count, so seeing the head IS the prioritisation signal a
  plain dropdown would hide.
- **Top-bar search** got the same leading magnifier for consistency.
- **Mention actions** split into two rows — workflow (claim / label / acknowledge) and
  moderation (spam / mute) — five buttons had been wrapping across three ragged lines,
  and the two groups are different kinds of decision.

**Test hygiene:** the suite invented ~2 topics per run (`Area <tag>`, `E2E Topic <tag>`)
and 109 had accumulated — that pollution *was* the checkbox wall. `db:clean-e2e` now
removes them, matched on the exact prefixes the specs use so real topics can't be hit.
- **2026-07-31 — Field report from an agent using the tools (acted on).**
  `pulse-queue` emitted `quality` only when it wasn't `normal`, to keep payloads small.
  That was wrong: omitting the key makes "not flagged" indistinguishable from "field
  missing", and an agent reading 265 rows concluded the field didn't work and fell back
  to `pulse-get-mention` per item. It is now **always** emitted — the bytes are worth
  far less than the ambiguity. Page size also dropped from 100 to 50: 100 rows fit the
  wire cap but not an agent's working context, and the reporter had to dump the queue
  to a file to analyse it.
  **Not acted on — `suspected-spam` does NOT imply `sentimentLabel: 'na'`.** The concern
  (ads scored positive inflating the score) is already solved: `suspected-spam` is
  excluded from every metric as of 2026-07-29, so a flagged ad contributes nothing. `na`
  means "not about Strapi" — a topicality judgement — and deriving it from a spam flag
  would conflate two independent axes and destroy `sentimentScore` on rows a human might
  later unflag.
- **2026-07-31 — Events can be annotated from Trends.** `POST /events` (validating
  action, not the core create) plus an inline form beside "Events in range". This is the
  one CRUD surface Pulse deliberately duplicates from the admin panel: the moment you
  realise an annotation is needed is while reading the chart thinking "that dip was
  v5.51", and sending someone to another app loses the context that made it worth
  writing. Editing and deleting stay in admin — this captures the moment, it isn't a
  manager. **Test note:** the title renders twice on purpose (chart annotation + list),
  and the SVG `<title>` is a tooltip that is never "visible" — assertions must scope to
  the list row.
- **2026-07-31 — P0s from the second field report.** `pulse-queue` omitted
  `authorHandle`, so **our own posts were indistinguishable from inbound ones in the
  list** — an agent nearly drafted public replies to three of ours and had already
  described one as an inbound question. The server clearly knew own-posts mattered
  (`pulse-acknowledge` has an `own-post` reason precisely to keep them out of metrics)
  but didn't surface it where the decision is made. `authorHandle` and
  `acknowledgeReason` are now on every row. Second: no `quality` filter, so "what still
  needs a spam judgement" required fetching every mention — there is now a `quality`
  arg.

### Lanes: route, don't filter (2026-07-31)

**The problem, measured:** of 393 real mentions, 198 name Webflow, 58 name Strapi, and
**zero name both**. Everything landed in one reply queue regardless, so a queue meant
for human replies was ~80% competitor discourse.

**Why the obvious fix is the wrong lever.** A keyword allowlist at ingest
(`strapi|webflow|headless cms`) keeps 256 of 393 and leaves the queue just as
Webflow-heavy, while permanently discarding 137 rows — including competitor-evaluation
threads naming none of those words. Filtering is lossy and unauditable: you cannot
audit what you never stored, and a too-narrow rule only shows up as a thread that never
surfaced.

**What we do instead.** Octolens already sends the search term that fired, tagged
`own_brand` / `competitor` / `industry_term` — present on **374 of 437** rows and
previously discarded. Routing on that is authoritative and free, and beats re-deriving
intent by scanning body text. Three lanes, set at ingest by `utils/lane.ts`:

| lane | rule | where it goes |
|---|---|---|
| `respond` | names Strapi, or an own-brand term matched | reply queue |
| `lead` | competitor/industry term **plus** switching or evaluation intent | reply queue |
| `monitor` | everything else | out of the queue, still in trends and themes |

Measured on the real corpus: **393 → 135 in the reply queue**, 258 to monitor, nothing
discarded. `laneReason` records which rule fired, so a wrong route is fixable rather
than mysterious — same contract as `qualityReason`.

**The `lead` lane is the point.** ~1 in 5 Webflow-only mentions carries switching intent
— people leaving on cost, comparing alternatives — and they typically contain no Strapi
keyword at all. Any rule that treats "Webflow-only" as low value throws those away.

**Deliberately no LLM.** The recommendation that prompted this proposed a
classification call per mention. `AI_API_KEY` is unset by design, so lanes are
deterministic (matched keyword + intent regex) and an agent refines them through
`pulse-set-lane` — the same server-picks-candidates / agent-judges split as spam
flagging. It upgrades to the AI sweep for free when a key is set.

**Unclassified defaults to `respond`**, not `monitor`: when in doubt a human sees it.
The failure mode of the other default is a thread that silently never surfaces.

**Build trap:** the octolens plugin compiles from its own `server/tsconfig.build.json`,
so it *cannot* import app code (`src/utils/…`) at build time — the import type-checks in
the app but the plugin's `dist/` never gets it, and ingest silently kept the old
behaviour. Classification is therefore exposed as `api::mention.mention.classifyLane`
and resolved at runtime. The plugin also needs its own `npm run build`; editing its
`src/` alone changes nothing.
- **2026-07-31 — Replying or acknowledging auto-claims.** Forgetting to press Claim left
  a mention ownerless even after someone did the work. Recording a public reply or
  acknowledging now adopts an **unowned** mention, and logs a `claimed` activity marked
  `auto: true` so the trail shows it wasn't a deliberate claim. It never reassigns a
  mention someone else owns.
  **Trap:** Strapi v5 keeps relations in a link table, so the raw row from
  `lockAndGuard` has **no `owner_id` column** — the first cut read `row.owner_id`, got
  `undefined` every time, and would have silently stolen every claimed mention. The
  check queries `mentions_owner_lnk` inside the same transaction. Verified by
  pre-assigning a mention to another user and confirming an acknowledge left ownership
  alone.
- **2026-07-31 — Pending mutations show a spinner.** Claim, Record response, Acknowledge
  and Save correction were already `disabled` while in flight, so double-submit was
  guarded — but nothing changed visually, and a slow request looks exactly like a dead
  button, which is what makes people click again. Added a shared `Spinner` (currentColor,
  so it works in both themes) plus a busy label on all four. Record response matters most:
  a second submit there would create two Response records.
  **Test note:** "claimed" renders twice by design (status badge + activity entry), so
  counting page text cannot distinguish one claim from two — the test asserts on the
  activity trail instead.
- **2026-07-31 — One-click "Ours" for our own posts.** Our team accounts get picked up by
  Octolens whenever they name Strapi, and the reply then sits in the queue looking like
  inbound work. `acknowledgeReason: 'own-post'` already meant exactly this and is
  excluded from every metric — it just cost a trip to the detail page and three clicks
  through the acknowledge panel. The button is on the queue card (where you recognise
  your own handle) and the detail page, and only renders on open mentions.
  **Follow-up worth doing:** this is still manual per post. A list of "our accounts"
  would let ingest route them automatically — deliberately NOT the mute list, since
  muting sets `quality: 'spam'` and removes a mention from analytics entirely, whereas an
  own-post should be acknowledged and merely excluded from *sentiment*.
- **2026-07-31 — Lane filters labelled, and "all lanes" added.** The sentiment row and
  the lane row wrapped into one visual line separated by a hairline, so the sentiment
  **all** pill read as "clear every filter" when it only ever cleared sentiment. Both
  groups now carry a small `sentiment` / `lane` label. The question also exposed a real
  gap: the lane options were reply work / leads / monitor with **no way to see the whole
  corpus at once** — `lane=all` now bypasses the filter entirely. Guarded by a test that
  asserts the two axes are independent (clicking sentiment `all` must not reset the lane).
- **2026-07-31 — Queue filters: one row per axis.** All the filters shared two wrapping
  rows, so a group could split mid-way — "monitor" and "all lanes" ended up on a
  different line from "reply work", making a lane read like a sentiment, and the
  sentiment **all** pill looked like it should clear everything. Now `FilterRow` gives
  each axis (topic · status · lane · sentiment · flags) its own line with an aligned
  label column, so groups can never interleave and the block scans vertically. The
  column is `w-24` because "SENTIMENT" is ~76px and was overrunning a 64px column into
  the first pill; it collapses to full width under `sm` so a phone doesn't lose a third
  of the row to a label. Broadest option first in every row (`queue`, `all lanes`,
  `all`) so the pattern is learnable.

### AI classification, provider-agnostic (2026-07-31)

Every ingested mention is now labelled by a model for **sentiment, topics, routing lane
and spam** in one call, ~60s after arrival via the existing sweep (never in the webhook —
a model call there risks Octolens timeouts and retry storms).

**Provider** is chosen in `services/provider.ts` via `AI_PROVIDER`:
`anthropic` | `openai` | `openai-compatible`. The last covers bring-your-own-model —
Ollama, vLLM, LM Studio, Together, DeepSeek — needing only `AI_BASE_URL`.
Built on AI SDK **7** (`ai@7.0.44`; v5 is two majors behind), `generateObject` + a zod
schema for provider-agnostic structured output.

**Cost is not the constraint.** ~53 mentions/day ≈ $1.77/mo on Haiku 4.5; the whole
spread to the cheapest credible model is ~$15/year. Chosen on instruction-following and
one-vendor operations, not price.

**The deterministic layer became an input, not a fallback** (pattern borrowed from the
`music-kb` value-score plan: compute objective signals first, let the model judge fit).
The prompt receives the Octolens matched keyword and its tag, channel, author, the
rule-based lane as a stated prior, and the **existing topic vocabulary** — the last is
what stops the model coining "Documentation" beside "Docs".

Measured against real mentions, the model overturned both known regex failures:
"Migration from v4 went fine" (`lead` → `monitor`, a completed upgrade, not shopping)
and the DXP marketing article (`lead` → `monitor` + `na`). It also promoted
"looking for a headless CMS for Next.js" from `respond` to `lead`, which the regex
missed. On the first real batch: 33 of 47 labelled `na` — a judgement the old code
literally could not express, since the AI type omitted `'na'` while the schema had it.

**Guardrails.** The model may raise `suspected-spam` but never confirm terminal `spam`
(that hides a mention from the queue *and* every metric, so it stays human).
`humanCorrected` rows are never re-queued or overwritten. The budget is now checked
*before* each call — it was previously consulted only by recluster, so classification
had no ceiling at all. Confirmed spam is excluded from selection rather than paid for.

**Traps hit:**
- `AI_MODEL` defaulted to `'claude-sonnet-5'`, **not a real model id** — the first call
  after setting a key 404s. Real defaults per provider now.
- The SDK's exported `anthropic`/`openai` singletons read `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY`, silently ignoring Pulse's vendor-neutral `AI_API_KEY`. Providers are
  constructed with the key explicitly.
- A `max(200)` on the reason fields failed **2 of 5** real calls with
  `NoObjectGeneratedError`. A schema constraint tighter than the model's natural output
  is an error rate, not a guardrail — 400 chars is 15/15.
- Zod-3 + AI SDK 7 generics trip TS2589; the cast is confined to the one call site and
  runtime validation is unaffected.

**Chat is a separate switch.** `AI_CHAT_ENABLED` (default false) gates the assistant,
because it is a tool-calling agent that can *write* the queue — enabling classification
must not turn it on as a side effect. `insights/config` returns both flags.

**Reclassify** lives in its own Settings card, not beside "Rescan history" in Muted
authors (which re-applies mutes and read as though it re-ran analysis). Needed because a
mention labelled by the Octolens fallback is already `analysisStatus: 'analyzed'`, so
turning AI on changes nothing for the backlog without an explicit re-queue.
`GET /analysis/status` reports model, tokens spent and how many rows are unclassified.
- **2026-07-31 — Classification criteria are typed data, not prompt prose.**
  `src/classification/criteria.ts` is the single source of truth for lanes: the `test`,
  positive/negative examples, whether evidence is required, and the badge. The prompt is
  **generated** from it, server-side verification reads `requiresEvidence` from it, and
  the UI badge uses its labels — so a rule cannot drift from behaviour. Tuning a lane is
  now a data edit with a measurable before/after, not a prompt rewrite.
- **2026-07-31 — `lead` must cite the author's own words.** Reviewing the first AI-assigned
  leads, **4 of 8 were wrong**: a *completed* migration ("we just rebuilt it in Next.js"),
  two complaints about Webflow, and one whose stated reason was that the post "signals
  **pote**ntial dissatisfaction" — inferred intent that was never in the text. The model
  was scoring competitor *frustration* as buying intent.
  Fix: `lead` requires `laneEvidence`, a verbatim quote, and the server checks that quote
  actually appears in the mention (normalised) before accepting the lane; otherwise it is
  demoted to `monitor` with the reason recorded. A model cannot quote a phrase that isn't
  there, so this is a check rather than a hope.
  Measured on a hand-labelled set: false leads 4/4 rejected. Recall needed tuning — the
  first rubric was so strict it also rejected real leads (1/4 kept); after loosening the
  criteria data, 6/8 overall. **Two real leads are still missed** ("thinking about
  switching over to payload", "started exploring Payload"), so this trades recall for
  precision and the criteria file is where to keep tuning it.
- **2026-07-31 — Reclassify only touches rows missing a score.** The button previously
  re-queued Octolens-labelled rows too, which already have a (coarse) score — pressing it
  twice re-spent on the same mentions. Two scopes now: the button does `missing` only, and
  a separate quieter action offers the one-off `fallback` upgrade for Octolens-labelled
  rows that lack a model lane and topics.
- **2026-07-31 — Lane is visible on the card.** `lead` (emerald) and `monitor` (muted) are
  badged with `laneReason` in the tooltip; `respond` is deliberately not badged, being the
  default view. Verified: the **budget ceiling works** — at 514,503/500,000 the sweep
  logs and pauses instead of spending.
- **2026-07-31 — "Not spam" no longer wraps.** The 400-char `qualityReason` sat beside the
  button in a flex row and squeezed the label onto two lines. The no-wrap treatment is
  applied to the **detail view only**: on the queue card the button is `compact` and must
  stay shrinkable — pinning it there pushed the action row past a 412px phone and put the
  whole page into horizontal scroll, which `responsive.spec` caught immediately. Worth
  remembering that a fix for one viewport is a regression for another unless it is scoped.
- **2026-07-31 — `n/a` is no longer struck through.** Strikethrough reads as *retracted*
  or *invalid*, but `n/a` means "not about Strapi" — a deliberate, correct classification.
  It was a rare edge case when the badge was written; automatic classification made it
  **45% of labelled mentions** (191 of 422) on a competitor-heavy corpus, and half the
  queue looking crossed out reads as damage. Muted grey already carries "excluded from
  the numbers".
- **2026-07-31 — Timeline entries can be re-filed between comment / note / feedback.** The
  update controller already accepted `kind`; only the edit form didn't expose it, so a
  misfiled entry was stuck. That matters because **only `feedback` reaches the Feedback
  page** — a pain point typed as a quick comment never reaches product, and the fix was
  previously delete-and-retype. Tested end to end: comment → re-file as feedback → it
  appears on `/feedback`.
- **2026-08-03 — The docs MCP actually connects, and a button proves it.** OAuth died at
  the token exchange with a bare `Missing client_id`, leaving the drafter ungrounded while
  the UI said nothing was wrong. Cause: `clientInformation()` rebuilt a bare
  `{client_id, client_secret}` and dropped the `token_endpoint_auth_method` we registered
  with, so the SDK fell back to its own preference — `client_secret_basic`, which it picks
  whenever a secret exists and the server lists basic *at all*, whatever order the server
  listed them in. kapa.ai reads `client_id` from the request body only. Stating the method
  fixes it. Worth recording that the obvious probe **could not confirm this**: kapa returns
  an identical generic `invalid_grant` for a bogus code whether credentials arrive in the
  header, the body, or not at all, so only a real code distinguishes them.
  Hence `POST /mcp-servers/:id/test` and the **Test** button — one real tool call with a
  generic question, reporting tool name, elapsed ms, result count and a preview. `connected`
  only ever meant the handshake and `tools/list` worked, which is a much weaker claim than
  it reads as. It never writes `status`: a failing test is information, not a state change.
  Verified live: `search_strapi_knowledge_sources` · 3940 ms · 15 results.
  The consequence is largest for **Refine**, which changes job description based on this —
  with no server connected it may only touch grammar, tone and structure and must copy every
  technical statement verbatim; with one connected it is told to check each claim, and the UI
  says which of the two happened.
- **2026-08-03 — Lead capture closes three gaps that made it look automatic when it wasn't.**
  (1) `leads.persist()` was reachable only through `POST /people/rescore`, which **nothing in the
  app called** — the only caller in the repo was a test. A mention promoted to `lead` left its
  author scoreless indefinitely. The sweep now rescores the author whenever a lane touches `lead`;
  it is pure arithmetic over rows already read, runs after commit, and a failure warns rather than
  parking the mention. (2) `pulse-set-lane` never set `humanCorrected`, so the next sweep silently
  overturned a deliberate route — a judgement stated with a reason is exactly what that flag exists
  to protect. (3) Routing was correctable by an agent and by **nobody in this app**: a human who
  spotted a missed lead had to open Claude Code. The correction panel now carries the lane, and
  saving one rescores the author immediately.
  The deliberate asymmetry: moving a mention OUT of `lead` clears `laneEvidence`, moving one IN
  cannot mint it — the 50-point signal is a quote verified verbatim against the post, so a
  hand-routed lead scores as `watch`/`warm` and **never `hot`**. The panel says so inline.
  Also made real: `person-scored`, a declared activity type that was never written. Logged on band
  CROSSINGS only — an entry per rescore would bury the notes, the same reason `setStatus` skips
  no-op transitions.
  Verified end to end on a real row: routing to `lead` scored the author 21 (`watch`) — 15 lane +
  10 competitor, decayed ×0.84 for a 26-day-old post, matching the formula exactly — and routing
  back returned it to 0/`none`, with both band crossings in the trail. e2e 54 passing, 3 skipped.
  **Not verified live: the sweep's rescore call.** Today's usage is 503,668/500,000, so `run()`
  returns at the budget check before classifying anything. Everything it depends on is proven
  elsewhere — `correct()` reads `person.documentId` through the same document-service populate and
  its rescore fired — so what remains untested is only the lane condition in that one branch.
- **2026-08-03 — Lead scoring gets its own cron and its own card, separate from classification.**
  The question was whether leads need a second classification pass. They do not: `analyze()`
  already returns `lane`, `laneEvidence` and `leadDirection` in the SAME call as sentiment, topics
  and spam, so a separate lead pass would re-send the same post to the same model for a field it
  already answered. What *is* separate is scoring, which is arithmetic over stored rows — 402
  people in about a second, no tokens.
  It needed a home because of decay, not because rows were missing: intent holds full weight for
  14 days then fades to zero at 90, yet a score is only written when something touches that person.
  A lead scored 90 in July still reads 90 in October. Nothing recomputed it — the registered crons
  were sweep, recluster, staleDigest, budgetReset and octolensSync, and `POST /people/rescore` had
  no caller outside a test. So: a `leadRescore` cron at 03:30 (after recluster, since lanes decide
  leads) and a Settings card with the manual button for after a batch of hand-routing.
  Kept OUT of the Automatic classification card deliberately. Everything in that card spends
  tokens and shows a budget; a free action sitting beside a metered one reads as metered. The card
  states "no model call, no tokens" and the e2e test asserts that line is present.
  `GET /people/leads-status` reports scored / hot / warm / lastScoredAt / staleCount, because "when
  was this last computed" is the only thing separating a current board from a stale one, and it was
  previously invisible. Verified live: 38 scored (11 hot, 3 warm), and a rescore of 402 people took
  ~1s and moved `lastScoredAt` 19:56 → 20:39. e2e 55 passing, 3 skipped. The cron is registered the
  same way as the other five but has not been observed firing — it next runs at 03:30.
- **2026-08-03 — A Person is an internal id; social accounts hang off it (phase A).** `Person` was
  one row per social account by construction: `identityKey` unique and required, `channel` a single
  relation. Nine of its fields described an account, not a human, and the schema physically could
  not hold a second presence — so the same person on X and Reddit was two rows, and the only way to
  say otherwise was a `mergedInto` tombstone with one half hidden. Identity now lives on
  `api::social-account`, and a person holds N of them. The 5 previously-merged pairs became one
  person with two accounts rather than one live row and one hidden one.
  `ensure()` resolves the ACCOUNT first, then its person, which collapses two asymmetric adoption
  branches into one rule — same handle, same channel, same human — so arrival order stops mattering.
  Verified live: injecting handle-only then handle+profileURL, the order that used to fork, produced
  one person with `x:fix…` and `x.com/fix…`. Reads derive a primary account (most recently active)
  for single-identity views, widest reach ACROSS accounts for followers, and an alias list for the
  person page: 200 followers on Bluesky and 40k on X should not read as small because they last
  posted somewhere quiet.
  Two bugs the tests caught. (1) `Person.identityKey` was still `required`, so after the rewrite
  every ingest failed with "identityKey must be defined" — and intake's per-item isolation logged a
  warning and left the mention unlinked rather than erroring, which is exactly the failure mode that
  isolation is meant to buy and also the one that hides it. (2) The already-merged guard read
  `loser.mergedInto` without populating it, so it was always undefined and a second merge returned
  200 instead of 409 — a relation is ABSENT, not null, when you do not ask for it.
  **Phase B is deliberately not done.** Dropping the moved columns must be a SECOND deploy: Strapi
  drops a column the moment its attribute leaves the schema, and the copy above runs in `bootstrap()`
  — after `syncSchema()` — so a single deploy would drop the source data before anything read it. It
  cannot be a `database/migrations` file either: migrations run BEFORE sync
  (`@strapi/database/dist/schema/index.js:73`), and on the introducing deploy `social_accounts` does
  not exist yet. Phase B ships with a guard migration that throws while the columns still exist if
  any person has an `identity_key` with no matching account row — in the SAME deploy as the drop,
  because umzug runs each migration exactly once and an earlier one would pass trivially and never
  fire again.
  e2e 57 passing, 3 skipped. Also learned: two `strapi develop` processes against one SQLite file
  turn a 42-second suite into 13.8 minutes and produce phantom failures.
