# Technical Requirements — Pulse

> Verified against Strapi v5 docs (https://docs.strapi.io) on 2026-07-24.
> When in doubt during build, query the strapi-docs MCP first.
> Architecture principles from stage 4: heavy lifting in the Strapi backend; modules as **local plugins** (`src/plugins/*`); thin Next.js 16 frontend.

## Strapi content types

### `api::mention.mention` — collection-type
| Field | Type | Notes |
|-------|------|-------|
| externalId | string | **unique, required** — dedupe key from the source (webhook redelivery-safe) |
| content | text | the mention text as it arrived |
| authorHandle | string | public handle of the author |
| url | string | permalink to the mention |
| postedAt | datetime | when it was posted on the platform |
| receivedAt | datetime | when Pulse ingested it |
| channel | relation: manyToOne → `api::channel.channel` | platform it came from |
| sentimentScore | decimal | −1.0 … 1.0, computed by the `analysis` plugin |
| sentimentLabel | enumeration: `positive` `neutral` `negative` | derived from score |
| analysisStatus | enumeration: `pending` `analyzed` `failed` | drives the cron retry sweep |
| status | enumeration: `unanswered` `claimed` `answered` `resolved` | the core-loop workflow |
| owner | relation: manyToOne → `plugin::users-permissions.user` | **server-set** on claim (controller) |
| assignee | relation: manyToOne → `plugin::users-permissions.user` | **server-set** on person-level routing; assignee gets a Slack ping |
| suggestedTeam | enumeration: `devrel` `marketing` `product` (optional) | set by routing/flagging |
| topics | relation: manyToMany → `api::topic.topic` | assigned by analysis; human-correctable |
| humanCorrected | boolean (default false) | set when a human overrides sentiment/topics — re-analysis must **never** overwrite corrected fields |
| modelVersion | string | model id that produced the analysis (trend integrity) |
| promptVersion | string | prompt revision that produced the analysis |
| activities | relation: oneToMany → `api::activity.activity` | system-written audit trail |
| raw | json | original webhook payload (audit / **replay**) |

- Draft & publish: **no** (workflow is the explicit `status` enum)
- Note: stage 3 suggested a reusable `source` component; flattened here because the dedupe key (`externalId`) needs a **unique** constraint, which belongs on a top-level field.

### `api::response.response` — collection-type
| Field | Type | Notes |
|-------|------|-------|
| mention | relation: manyToOne → `api::mention.mention` | required |
| draftText | text | the AI draft the response started from (may be empty) |
| finalText | text | what was actually posted, required |
| respondedBy | relation: manyToOne → `plugin::users-permissions.user` | **server-set** in controller |
| respondedAt | datetime | server-set |
| notes | text | context, links, internal commentary |
| outcome | component: `shared.outcome` (single) | how it landed; may be recorded later |

- Draft & publish: **no**

### `api::topic.topic` — collection-type (machine-created, admin-curated)
| Field | Type | Notes |
|-------|------|-------|
| name | string | required, unique |
| slug | uid (target: name) | ⚠️ uid is NOT auto-filled on API writes — generated in Document Service middleware |
| kind | enumeration: `feature` `bug` `docs` `competitor` `other` | |
| description | text | |

### `api::event.event` — collection-type (editorial, admin panel)
| Field | Type | Notes |
|-------|------|-------|
| title | string | required |
| date | datetime | required — annotates the trend timeline |
| kind | enumeration: `release` `launch` `incident` | |
| notes | text | |

### `api::dead-letter.dead-letter` — collection-type (system-written; ingest failures)
| Field | Type | Notes |
|-------|------|-------|
| raw | json | the payload exactly as received |
| error | text | why validation/normalization failed |
| receivedAt | datetime | |
| resolved | boolean (default false) | set true after successful replay |

### `api::activity.activity` — collection-type (system-written only; no create/update via public API)
| Field | Type | Notes |
|-------|------|-------|
| mention | relation: manyToOne → `api::mention.mention` | required |
| actor | relation: manyToOne → `plugin::users-permissions.user` | null for system actions (ingest, analysis) |
| action | enumeration: `ingested` `analyzed` `claimed` `routed` `corrected` `answered` `resolved` `replayed` | |
| detail | json | e.g. `{ from: 'unanswered', to: 'claimed' }`, correction before/after |
| at | datetime | server-set |

### `api::channel.channel` — collection-type (editorial, admin panel)
| Field | Type | Notes |
|-------|------|-------|
| name | string | required, unique (e.g. "X", "Reddit", "LinkedIn") |
| key | string | required, unique — matches the source's platform identifier |
| url | string | |

## Components

### `shared.outcome`
| Field | Type | Notes |
|-------|------|-------|
| result | enumeration: `resolved` `positive-turn` `no-reaction` `escalated` | |
| notes | text | |
| recordedAt | datetime | |

## Dynamic zones
None — Pulse is a data/insight tool.

## Modules (Strapi-native `src/api/` folders — REVISED from local plugins during build)

| Module | Owns | Exposes |
|---|---|---|
| `ingest` | Octolens webhook receiver: verify secret, validate + normalize, dedupe on `externalId`, create Mention (`analysisStatus: pending`); payloads that fail validation → **dead-letter record** (raw + error, ops alert, replayable). Greenfield — no historical import | `POST /api/ingest/octolens`; replay |
| `analysis` | Sentiment scoring, topic assignment/clustering, AI draft generation — all behind a **provider-agnostic AI interface** (v1 provider: Claude/Anthropic; swappable). **AI is optional**: without `AI_API_KEY` these features are disabled (mentions → `analysisStatus: skipped`, sentiment null, manual labeling via correct; drafts/chat 503; `GET /api/insights/config` → `{ aiEnabled }` drives the UI) — the core loop runs fully without AI, and skipped mentions auto-analyze once a key is added. Stamps `modelVersion`/`promptVersion`; skips `humanCorrected` fields; tracks daily token spend against `AI_DAILY_TOKEN_BUDGET` (warn 80% → ops Slack; at 100% halt re-cluster, never new-mention analysis) | service `plugin::analysis.analyze(mentionId)`, `draft(mentionId)`; cron sweep |
| `assistant` | Chat over the data: NL question → data queries → answer/report | `POST /api/assistant/chat` |
| `notify` | Slack notifications: new-mention channel (priority `negative`), assignee pings, daily stale digest, **ops channel** (sweep failures, secret-rejection spikes, budget warnings) | subscribes after analysis; consumed by cron + routing |
| `src/mcp/` (app-level, registered in `src/index.ts` `register()`) | Custom MCP tools registered app-level on the **official** built-in MCP server via `strapi.ai.mcp` (a plugin is optional for custom tools) | tools: `pulse.search-mentions`, `pulse.trend-summary`, `pulse.theme-report` |

> ⚠️ Strapi Cloud has no separate worker processes. **Analysis runs via cron (decided):** the ingest webhook only stores the mention (`analysisStatus: pending`) and returns 200 fast; a frequent cron sweep (every minute) analyzes pending/failed mentions and fires Slack notifications after analysis. This keeps the webhook snappy and gives natural retries. Future upgrade path: an external queue service — the `analysis` service interface stays the same.

## API surface

### REST (auto-generated, used by the frontend)
- `GET /api/mentions` — authenticated; filters: `status`, `sentimentLabel`, `topics`, `channel`, date range; sort `postedAt:desc`; paginated
- `GET /api/mentions/:documentId` — authenticated
- `GET /api/topics`, `GET /api/events`, `GET /api/channels` — authenticated
- `GET /api/responses?filters[mention]…` — authenticated
- **Disabled entirely for Public** — no anonymous access to any content API. Auto `POST/PUT/DELETE /api/mentions` disabled for everyone (mentions enter only via ingest webhook; workflow changes only via custom routes below).

### Default population strategy
- API-scoped middleware `api::mention.populate-mention` in `src/api/mention/middlewares/populate-mention.ts` (UID must match the path — `src/middlewares/` would be `global::` and silently not load), applied in the route file for `GET /api/mentions*`: populates `channel`, `topics`, `owner` (id + username only), `responses` (+ `outcome`).

### Custom routes
| Method & path | Auth | Handler behavior |
|---|---|---|
| `POST /api/ingest/octolens` | `auth: false` + shared-secret header check (reject without it) | Verify → dedupe by `externalId` → create Mention (`analysisStatus: pending`) via Document Service → return 200 (analysis + notify happen in the cron sweep) |
| `POST /api/mentions/:documentId/claim` | authenticated | Controller stamps `owner = ctx.state.user` **via Document Service** (server-set; never from body) and sets `status: claimed` |
| `POST /api/mentions/:documentId/route` | authenticated | Sets `suggestedTeam` and/or `assignee` (server-set from a validated user id); Slack pings the assignee/team; logs `routed` activity |
| `POST /api/mentions/:documentId/correct` | authenticated | Human override of `sentimentLabel`/`sentimentScore`/`topics`; sets `humanCorrected: true`; logs `corrected` activity with before/after; re-analysis skips corrected fields forever |
| `POST /api/mentions/:documentId/replay` | authenticated | Re-runs the stored `raw` payload through analysis (respects `humanCorrected`); logs `replayed` |
| `GET /api/search?q=…` | authenticated | Postgres full-text search across mention content and response finalText/notes; returns matches with type + highlight |
| `GET /api/insights/stale?days=N` | authenticated | Unanswered/claimed mentions older than N days (drives queue flags + daily digest) |
| `POST /api/mentions/:documentId/draft` | authenticated | `analysis` plugin generates an AI draft grounded in official Strapi docs; returns `{ draft }` — **not persisted** until a Response is created |
| `POST /api/responses` | authenticated | Creates Response; controller stamps `respondedBy`/`respondedAt` via Document Service; sets parent mention `status: answered` |
| `PUT /api/responses/:documentId/outcome` | authenticated | Records `shared.outcome`; if `result: resolved` → mention `status: resolved` |
| `GET /api/insights/trends?from&to&topic` | authenticated | Aggregation: **the Pulse score** (defined below) over time + events in range for annotation |
| `GET /api/insights/themes?window` | authenticated | Recurring-theme feed: topics ranked by volume/negativity trend, with evidence mention ids |
| `POST /api/assistant/chat` | authenticated | `{ messages } → { answer, data? }` — NL Q&A over mentions/sentiment/themes |

### GraphQL
Not installed.

## The Pulse score (single source of truth for "sentiment improved")
- **Definition**: per day, the **volume-weighted mean of `sentimentScore` over a trailing 7-day window**, scaled to 0–100 (`(mean + 1) × 50`). Computed overall and per topic/channel by the `insights` controller — one formula, documented here, used by every surface (dashboard, digest, MCP tools, chat).
- **Stability rules**: human-corrected scores participate like any other; a model/prompt change (new `modelVersion`) is annotated on the trend line like an Event so a step-change is attributable, not mysterious. Historical mentions are never silently re-scored — re-scoring old data is an explicit, logged replay.
- **Why trailing-7d**: smooths single-viral-thread spikes without hiding real shifts; daily buckets keep release/incident alignment readable.
- **Buckets are UTC** — one convention everywhere (score, digest, charts) so trends are timezone-proof; the frontend renders in local time but aggregates never shift.

## MCP server (enabled — stage 4)
- `mcp: { enabled: true }` in `config/server`; endpoint `POST /mcp`; Strapi **≥ 5.49** (GA)
- Auth: **scoped Admin API tokens** — a **read-only** token for reporting clients (list/get on mention, topic, event); no write tools in v1
- Custom tools from `pulse-mcp-tools` (registered in `register()`, before `mcp.start()`): `pulse.search-mentions`, `pulse.trend-summary`, `pulse.theme-report`
- Known limitations respected: no media upload via MCP; stateless `POST /mcp` only
- Pattern references: official blog post on custom tools via a plugin + `strapi-demo-store-mcp` (inspiration only)

## Auth flows (stock Users & Permissions)
- **No self-signup** — U&P registration closed; Admin creates team accounts in the Strapi admin panel.
- Sign-in: `POST /api/auth/local` → JWT. Next.js stores the JWT in an **httpOnly cookie** via a route handler; Server Components forward it on SSR fetches to Strapi.
- Sign-out: clear the cookie client-side (JWTs are stateless).
- Password reset: U&P forgot-password flow — ⚠️ requires an email provider; v1 has none (Slack-only), so password resets are admin-performed in the panel. Flagged as a conscious v1 tradeoff.
- Docs: https://docs.strapi.io/cms/features/users-permissions

## Permissions & roles (U&P)
- **Public**: nothing. (The ingest webhook route uses `auth: false` + secret — a route config, not a Public permission.)
- **Authenticated** (= team member): `find/findOne` on mention, topic, event, channel, response, activity; access to all custom routes above — claim, route, draft, correct, replay, respond, outcome, search, trends, themes, stale, chat (each custom route action enabled per role). Dead letters are admin-panel-only.
- **Admin panel roles**: Super Admin (Paul) manages accounts, topics curation, events, channels. Editors optional later.
- Extensibility: future roles (e.g. read-only stakeholder) = new U&P role + per-route permission flips; no schema change.
- Server-set fields (`owner`, `respondedBy`) are never accepted from the request body — stamped in controllers via the Document Service (naive body injection 400s in v5).
- No `is-owner` policy in v1 — deliberate: internal high-trust team; any member may act on any mention.

## Lifecycles / policies / middlewares (v5 layering)
- **Controllers** (request context): stamp `owner` on claim, `respondedBy` on response create, set workflow `status` — via Document Service (`strapi.documents(...)`)
- **Document Service middleware** (`strapi.documents.use()` in `register()`): generate `topic.slug` (uid fields are NOT auto-filled on API/seed writes — every uid-filtered type needs this)
- **Route middleware**: `api::mention.populate-mention` (population, above); ingest secret check
- **Lifecycle hooks: none** — no request context, double-fire on publish; all business logic lives in the layers above
- **Policies**: none in v1 (no ownership gating); slot exists for future role gates

## Pages & components (Next.js 16, `app/`)

| Route | Fetch (RSC unless noted) | Components / notes |
|---|---|---|
| `/` — queue | `GET /api/mentions?filters[status][$in]=unanswered,claimed` sorted oldest-first | MentionList, SentimentBadge, **StalenessFlag** (age > `STALE_AFTER_DAYS`), ClaimButton (client), **SearchBox** (→ `/api/search`), filters in URL state. **Empty state** designed for the greenfield early weeks |
| `/mentions/[id]` | `GET /api/mentions/:documentId` (populated) | MentionDetail, DraftPanel (client — calls `/draft`), RespondForm (client), OutcomeForm, **CorrectionControls** (sentiment/topic override → `/correct`), **ActivityTimeline**, past responses on same topics |
| `/trends` | `GET /api/insights/trends` | TrendChart with event annotations, range/topic filters (URL state) |
| `/themes` | `GET /api/insights/themes` | ThemeFeed (product feedback pipeline), evidence drill-down |
| `/chat` | client → `POST /api/assistant/chat` | Chat UI (TanStack Query mutation) |
| `/sign-in` | — | U&P login → httpOnly cookie route handler |
| `/settings` | admin-ish links | Deep-links into Strapi admin for accounts/topics/events (no duplicate CRUD UI in v1) |

## State management
- Server state: RSC fetches with the forwarded JWT; TanStack Query for client refetches (queue polling, chat, claim/respond mutations)
- URL state: queue filters, trend ranges
- Client state: minimal (forms, dialogs)

## Background jobs (`config/cron-tasks.ts`, `cron.enabled: true`)
- `* * * * *` — analysis sweep: process `analysisStatus: pending|failed` mentions (sentiment + topics; stamp model/prompt version; skip human-corrected fields), then Slack-notify newly analyzed ones (priority: negative). **Errors → ops Slack.**
- `0 3 * * *` — nightly topic re-cluster + theme-feed rollup (never touches `humanCorrected` mentions; skipped if AI budget exhausted)
- `0 9 * * 1-5` — weekday stale digest to Slack: unanswered/claimed older than the SLA threshold (`STALE_AFTER_DAYS`, default 2)
- `0 0 * * *` — reset the daily AI token counter

## Media & uploads
- Strapi Cloud media (default). Minimal usage in v1.

## Environment variables

### Strapi backend (apps/cms)
- `DATABASE_URL`, `APP_KEYS`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` — Strapi Cloud injects
- `OCTOLENS_WEBHOOK_SECRET` — shared secret the ingest route requires
- `AI_PROVIDER` (`anthropic` in v1), `AI_API_KEY` — provider-agnostic AI config consumed by `analysis`/`assistant`
- `STRAPI_DOCS_MCP_URL` — endpoint of the Strapi docs MCP server the `analysis` plugin consumes for draft grounding (decided: docs MCP directly; kapa.ai stays external — used when the app itself is consumed via MCP from Claude Desktop)
- `SLACK_WEBHOOK_URL` — team notifications channel
- `SLACK_OPS_WEBHOOK_URL` — ops channel (pipeline failures, dead letters, budget warnings)
- `PULSE_APP_URL` — the deployed frontend URL; every Slack notification deep-links `<PULSE_APP_URL>/mentions/<id>`
- `AI_DAILY_TOKEN_BUDGET` — daily token cap (warn at 80%, halt re-cluster at 100%)
- `STALE_AFTER_DAYS` — SLA threshold for staleness flags + digest (default 2)

### Frontend (apps/web) — Next.js public prefix is `NEXT_PUBLIC_`
- `NEXT_PUBLIC_STRAPI_URL` — public Strapi URL (browser-safe)
- **No `STRAPI_API_TOKEN`** — every data fetch is per-user (JWT cookie); no anonymous SSR content exists. If a static/public page ever appears, add an unprefixed server-only token then.

## Open items (carried to stage 6)
1. ~~Docs-grounding mechanism~~ **Decided:** the `analysis` plugin consumes the **Strapi docs MCP** directly for draft grounding; kapa.ai remains an external layer for Claude-Desktop-side usage.
2. ~~Async model~~ **Decided:** cron-based analysis sweep (webhook stores only); external queue services are a future exploration.
3. ~~Historical data~~ **Decided:** greenfield — fresh collection from launch, no migration; empty states cover the early weeks.
4. Primary AI provider assumed **Claude/Anthropic** behind the provider-agnostic interface — unobjected, treated as confirmed.
5. Mention volume assumption (low-to-mid hundreds/day, ~1yr history) — design comfortable at 10× that. No auto-deletion/retention policy in v1.
6. Password reset without an email provider — admin-performed in v1; add an email provider if this grates.
7. Octolens pull/list API availability (for gap reconciliation after webhook downtime) — investigate during build; dead-letter replay is the fallback.
