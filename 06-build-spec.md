# Pulse — Build Spec

> Hand this file to any coding agent (Claude Code, Cursor, etc.) — it is self-contained.
> **Build target**: Strapi v5 (**≥ 5.49.0**, MCP GA floor) on Strapi Cloud + Next.js 16 (App Router) on Vercel.
> **Docs lookup**: query the `strapi-docs` MCP if installed; otherwise WebFetch https://docs.strapi.io. Key pages: Document Service (https://docs.strapi.io/cms/api/document-service) · Controllers (https://docs.strapi.io/cms/backend-customization/controllers) · Routes & policies (https://docs.strapi.io/cms/backend-customization/routes) · Populate (https://docs.strapi.io/cms/api/rest/populate-select) · Users & Permissions (https://docs.strapi.io/cms/features/users-permissions) · Plugin development (https://docs.strapi.io/cms/plugins-development/developing-plugins) · MCP server (https://docs.strapi.io/cms/features/strapi-mcp-server) · Cron (https://docs.strapi.io/cms/configurations/cron).

## Project overview
Pulse is the Strapi team's internal, single-instance tool for tracking sentiment across social mentions, capturing the full response trail (who replied, what was said, how it landed), and turning recurring signals into product decisions. Mentions arrive via an Octolens webhook; Pulse computes sentiment and topics, drafts AI answers grounded in official Strapi docs, notifies Slack, and exposes its data to AI clients through Strapi's official built-in MCP server. One-liner: *the team's shared pulse on what the community feels — and proof our responses move the score.*

## Stack
- Backend / CMS: Strapi v5 **≥ 5.49.0**, Node ≥ 20, TypeScript
- Database: PostgreSQL (Strapi Cloud managed; SQLite for local dev only)
- Backend hosting: Strapi Cloud · Frontend: **Next.js 16** (App Router) on Vercel
- Auth: **stock Users & Permissions** (closed registration — admin-invited accounts; JWT in httpOnly cookie)
- AI: provider-agnostic interface in the `analysis`/`assistant` plugins; v1 provider **Anthropic (Claude)**; draft grounding via the **Strapi docs MCP** consumed backend-side
- Notifications: Slack incoming webhook · Styling: Tailwind + shadcn/ui
- **Architecture principles**: heavy lifting in Strapi (thin, swappable frontend); modules as **local plugins** in `src/plugins/*` (greenfield — inspiration repos are patterns only, nothing imported)

## Repo layout
```
pulse/
├── apps/
│   ├── cms/                      # Strapi v5
│   │   └── src/plugins/          # LOCAL plugins: ingest, analysis, assistant, notify, pulse-mcp-tools
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

# 3. Local plugins (per plugin, inside apps/cms): scaffold with the plugin SDK, then move into src/plugins/
npx @strapi/sdk-plugin init src/plugins/ingest        # repeat: analysis, assistant, notify, pulse-mcp-tools
```
Register each local plugin in `apps/cms/config/plugins.ts`:
```ts
export default () => ({
  ingest:            { enabled: true, resolve: './src/plugins/ingest' },
  analysis:          { enabled: true, resolve: './src/plugins/analysis' },
  assistant:         { enabled: true, resolve: './src/plugins/assistant' },
  notify:            { enabled: true, resolve: './src/plugins/notify' },
  'pulse-mcp-tools': { enabled: true, resolve: './src/plugins/pulse-mcp-tools' },
})
```

## Build order

### M1 — Strapi scaffold + Strapi Cloud project linked
- [ ] Scaffold as above; boots locally on Postgres (`npm run develop`)
- [ ] Create Strapi Cloud project at https://cloud.strapi.io, connect repo, root dir `apps/cms`, set env vars (below)
**Done when**: local boot works and `git push` deploys to Strapi Cloud.

### M2 — Content model
- [ ] Create the five collection types + one component from the schemas below (draft & publish OFF everywhere)
- [ ] Seed `channel` rows (X, Reddit, LinkedIn, …) matching Octolens platform keys
**Done when**: all types visible in admin; an admin can create Events/Topics/Channels.

### M3 — Auth (stock Users & Permissions, closed registration)
- [ ] Disable public registration (Admin → Settings → Users & Permissions → Advanced: registration off) — accounts are admin-created
- [ ] Configure role permissions per the Permissions section below
- [ ] **Seeding trap — both halves:**
  - Users seeded via the **U&P user service** (or `/api/auth/local/register` before closing it) — `strapi.query('plugin::users-permissions.user').create()` stores the password **unhashed** and login fails
  - Permissions: a fresh Strapi denies every action for BOTH roles — logged-in grants nothing. Each permission is its own record; admin-UI clicks don't survive a fresh DB. Seed in bootstrap:
```ts
const auth = await strapi.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } })
for (const action of [
  'api::mention.mention.find', 'api::mention.mention.findOne',
  'api::mention.mention.claim', 'api::mention.mention.route', 'api::mention.mention.draft',
  'api::response.response.find', 'api::response.response.create', 'api::response.response.outcome',
  'api::topic.topic.find', 'api::topic.topic.findOne',
  'api::event.event.find', 'api::event.event.findOne',
  'api::channel.channel.find', 'api::channel.channel.findOne',
  'api::insights.insights.trends', 'api::insights.insights.themes',
  'plugin::assistant.chat.chat',
])
  await strapi.query('plugin::users-permissions.permission').create({ data: { action, role: auth.id } })
// Public role: seed NOTHING (ingest webhook uses auth:false + secret, not a Public permission)
```
**Done when**: an admin-created user can log in via `POST /api/auth/local` and read mentions; anonymous requests get 401/403 on everything.

### M4 — Ingest, analysis, notify (the backend loop)
- [ ] **`ingest` plugin** — `POST /api/ingest/octolens`, route `config: { auth: false }`, controller: reject unless `x-pulse-secret` header equals `OCTOLENS_WEBHOOK_SECRET`; normalize payload; dedupe on `externalId` (return 200 on duplicate — webhooks redeliver); create Mention via Document Service with `analysisStatus: 'pending'`, `status: 'unanswered'`, `raw` = payload; return fast (NO AI work in-request)
- [ ] **`analysis` plugin** — provider-agnostic interface (`AI_PROVIDER`/`AI_API_KEY`; v1 = Anthropic): `analyze(mention)` → sentimentScore/label + topic assignment (create Topic via Document Service if new); `draft(mention)` → answer draft grounded via the **Strapi docs MCP** (`STRAPI_DOCS_MCP_URL`)
- [ ] **Cron** (`config/cron-tasks.ts`, `cron.enabled: true` in `config/server`):
  - `* * * * *` — sweep `analysisStatus: pending|failed` → analyze → mark `analyzed` → hand newly analyzed mentions to `notify` (Slack webhook; lead with `negative`)
  - `0 3 * * *` — re-cluster topics, roll up the themes feed
- [ ] **Custom workflow routes** (all authenticated; server-set fields NEVER read from the body — stamped in the controller via the Document Service; naive body injection 400s in v5):
  - `POST /api/mentions/:documentId/claim` → `owner = ctx.state.user.id`, `status: 'claimed'`
  - `POST /api/mentions/:documentId/route` → set `suggestedTeam`, optional Slack ping
  - `POST /api/mentions/:documentId/draft` → returns `{ draft }` from `analysis` (not persisted)
  - `POST /api/responses` → create Response, stamp `respondedBy`/`respondedAt`, parent mention → `status: 'answered'`
  - `PUT /api/responses/:documentId/outcome` → write `shared.outcome`; `result: 'resolved'` → mention `status: 'resolved'`
  - `GET /api/insights/trends` / `GET /api/insights/themes` → aggregations (time-bucketed sentiment + events; ranked recurring themes with evidence ids)
- [ ] Disable auto-generated `POST/PUT/DELETE /api/mentions` for every role (mentions mutate only via webhook + workflow routes)
- [ ] **Populate middleware** — file path must match the UID: `src/api/mention/middlewares/populate-mention.ts` → `api::mention.populate-mention` (a file in `src/middlewares/` is `global::` and silently never loads). Apply in the mention route config; populate `channel`, `topics`, `owner` (id, username), `responses` (+ `outcome`)
- [ ] **Topic slug** — uid fields are NOT auto-filled on API/seed writes: generate `topic.slug` in Document Service middleware (`strapi.documents.use()` in `register()`)
- [ ] **Lifecycle hooks: none** — no request context and they double-fire on publish; use the layers above
**Done when**: a signed webhook POST creates a mention; within a minute the cron has analyzed it and Slack pinged; claim → draft → respond → outcome transitions all work via the API.

### M5 — Frontend (Next.js 16, `app/`)
- [ ] Routes: `/` queue (unanswered+claimed, filters in URL state) · `/mentions/[id]` (detail, DraftPanel, RespondForm, OutcomeForm) · `/trends` (chart + event annotations) · `/themes` (product feed) · `/chat` · `/sign-in` · `/settings` (deep-links into Strapi admin)
- [ ] RSC fetches forward the JWT cookie; TanStack Query for mutations/refetch (claim, respond, chat, queue polling)
**Done when**: the queue renders live data for a signed-in user.

### M6 — Auth UI
- [ ] `/sign-in` → `POST /api/auth/local` via a Next route handler that sets the JWT in an **httpOnly cookie**; middleware guards all routes; sign-out clears the cookie
- [ ] Password reset is admin-performed in v1 (no email provider — conscious tradeoff)
**Done when**: unauthenticated visitors only ever see `/sign-in`; login/logout round-trips work.

### M7 — Assistant, MCP server, seed data
- [ ] **`assistant` plugin** — `POST /api/assistant/chat`: `{ messages }` → data-grounded answer/report (queries mentions/trends/themes via Document Service; same AI provider interface)
- [ ] **MCP** — `config/server.ts`: `mcp: { enabled: true }` (endpoint `POST /mcp`, Bearer = **scoped Admin API token**; create a **read-only** token for reporting clients). Register custom tools in `pulse-mcp-tools`'s `register()` (must run before `mcp.start()`): `pulse.search-mentions`, `pulse.trend-summary`, `pulse.theme-report` via `strapi.ai.mcp.registerTool(...)`. MCP limitations: no media upload; stateless POST-only
- [ ] **Seed**: 3+ team users (via U&P service — hashed passwords), channels, a dozen topics, 2-3 events, ~50 mentions across sentiments/statuses (Document Service), a handful of responses with outcomes
**Done when**: Claude Desktop connected to `POST /mcp` with the read-only token can run `pulse.trend-summary`; `/chat` answers "what were the top negative themes this month?" from seeded data.

### M8 — Deploy + smoke test
- [ ] Backend → Strapi Cloud (env vars below; Node ≥ 20); frontend → Vercel (root `apps/web`)
- [ ] Point Octolens webhook at `https://<cloud-url>/api/ingest/octolens` with the shared secret
- [ ] Smoke: real mention → analyzed + Slack ping → claim → draft → respond → outcome → visible in trends
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
    "suggestedTeam": { "type": "enumeration", "enum": ["devrel", "marketing", "product"] },
    "topics": { "type": "relation", "relation": "manyToMany", "target": "api::topic.topic", "inversedBy": "mentions" },
    "responses": { "type": "relation", "relation": "oneToMany", "target": "api::response.response", "mappedBy": "mention" },
    "raw": { "type": "json" }
  }
}
```

`response`: `mention` (manyToOne, inversedBy `responses`) · `draftText` (text) · `finalText` (text, required) · `respondedBy` (manyToOne → `plugin::users-permissions.user`) · `respondedAt` (datetime) · `notes` (text) · `outcome` (component `shared.outcome`, non-repeatable). D&P off.

`topic`: `name` (string, required, unique) · `slug` (uid, targetField `name`) · `kind` (enum: feature/bug/docs/competitor/other) · `description` (text) · `mentions` (manyToMany, mappedBy `topics`). D&P off.

`event`: `title` (string, required) · `date` (datetime, required) · `kind` (enum: release/launch/incident) · `notes` (text). D&P off.

`channel`: `name` (string, required, unique) · `key` (string, required, unique) · `url` (string) · `mentions` (oneToMany, mappedBy `channel`). D&P off.

`shared.outcome` (component, category `shared`): `result` (enum: resolved/positive-turn/no-reaction/escalated) · `notes` (text) · `recordedAt` (datetime).

## API surface
See M4 for the full custom-route table. Auto-REST used: `GET /api/mentions(+/:documentId)`, `GET /api/topics|events|channels|responses` — all Authenticated-only; **no Public content access**; mention auto-mutations disabled for all roles. Population via `api::mention.populate-mention` route middleware. No GraphQL.

## Auth
- Stock U&P, closed registration, admin-invited accounts, email/password → JWT
- Next.js keeps the JWT in an httpOnly cookie (set by a route handler at sign-in); RSC/SSR fetches forward it; middleware redirects signed-out users to `/sign-in`
- Roles: `Authenticated` = team member (everything above). Future roles = new U&P role + permission flips, no schema change. No `is-owner` policy in v1 (deliberate — high-trust internal team)

## Frontend route/page tree (Next.js 16, `app/`)
```
apps/web/app/
├── layout.tsx               # shell, nav, session provider
├── page.tsx                 # queue: unanswered + claimed, URL-state filters
├── mentions/[id]/page.tsx   # detail + DraftPanel + RespondForm + OutcomeForm
├── trends/page.tsx          # sentiment-over-time chart + event annotations
├── themes/page.tsx          # recurring-themes product feed
├── chat/page.tsx            # assistant chat (client, TanStack Query)
├── settings/page.tsx        # deep-links into Strapi admin
└── sign-in/page.tsx
```

## Environment variables

### Strapi (apps/cms)
- `DATABASE_URL`, `APP_KEYS`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` — Strapi Cloud injects
- `OCTOLENS_WEBHOOK_SECRET` — shared secret required by the ingest route
- `AI_PROVIDER` = `anthropic` (v1) · `AI_API_KEY` — consumed via the provider-agnostic interface
- `STRAPI_DOCS_MCP_URL` — Strapi docs MCP endpoint used for draft grounding
- `SLACK_WEBHOOK_URL` — notify plugin

### Frontend (apps/web) — Next.js public prefix is `NEXT_PUBLIC_`
- `NEXT_PUBLIC_STRAPI_URL` — public Strapi URL (browser-safe)
- No `STRAPI_API_TOKEN`: every fetch is per-user JWT; no anonymous content exists. If a public page is ever added, introduce an **unprefixed** server-only token then.

## Deployment
- **Backend → Strapi Cloud**: https://cloud.strapi.io → connect repo (root `apps/cms`) → env vars above → deploy on push. Docs: https://docs.strapi.io/cloud/getting-started/intro. U&P needs no extra auth env vars beyond the auto-injected `JWT_SECRET`.
- **Frontend → Vercel**: import repo (root `apps/web`), set `NEXT_PUBLIC_STRAPI_URL`, deploy
- **CORS**: `config/middlewares.ts` `strapi::cors` origin = the Vercel URL (no `*`)
- **Octolens**: point the webhook at the deployed ingest URL + secret

## POC acceptance criteria (the core loop, deployed)
- [ ] A webhook-delivered mention appears in the queue with sentiment + topics within ~1 minute, and Slack was notified
- [ ] A signed-in teammate claims it, generates a docs-grounded draft, records the response they posted manually, then records the outcome — status walks `unanswered → claimed → answered → resolved`
- [ ] `/trends` shows sentiment over time with event annotations; `/themes` ranks recurring topics with evidence
- [ ] `/chat` answers a natural-language question about the data
- [ ] Claude Desktop, connected to `POST /mcp` with the read-only token, runs `pulse.trend-summary` successfully
- [ ] Anonymous requests can reach nothing but `/sign-in` and the secret-gated webhook

## Open questions / parked items
- Social-provider integrations to auto-post replies — future phase (v1 is draft + manual reply + record)
- External queue service to replace the cron sweep at higher volume
- kapa.ai as an external grounding layer when the app is consumed from Claude Desktop
- Email provider (unlocks self-serve password reset)
- Volume assumption: low-to-mid hundreds of mentions/day, ~1yr history (design headroom ~10×)
