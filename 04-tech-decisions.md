# Tech Decisions

For each decision: what was chosen, what other options were considered, and why this one fits the requirements.

> **Architecture principle (user-stated):** the heavy lifting lives in the **Strapi backend** — ingestion, analysis, drafting, chat, notifications are all backend capabilities. The frontend is a thin client over Strapi's API, so a future frontend migration has small impact.
>
> **Modularity principle (user-stated):** Pulse is built **in modules, as local plugins scoped to the Strapi app** (`src/plugins/*`) — not separately published packages. Greenfield: the repos below are *inspiration only*, nothing is consumed directly.
>
> Reference material (patterns, not dependencies):
> - Octolens webhook ingestion (prior project): https://github.com/PaulBratslavsky/strapi-octolens-mentions-plugin
> - Custom MCP tools plugin architecture: https://github.com/nclsndr/strapi-demo-store-mcp and https://strapi.io/blog/how-to-extend-strapi-s-mcp-server-with-a-custom-tools-via-a-plugin
> - Provider-agnostic AI layer: https://github.com/PaulBratslavsky/strapi-plugin-ai-sdk

## Defaults applied (confirmed with user)

- **Backend / CMS**: Strapi v5 ✅ (**version ≥ 5.49** — MCP server GA floor)
- **Database**: PostgreSQL ✅
- **Backend hosting**: Strapi Cloud ✅
- **Frontend**: **Next.js 16** (App Router)
- **Auth**: **stock Users & Permissions** ✅ (default; Better Auth explicitly not needed)
- **Styling**: Tailwind ✅

## Backend / CMS
- **Choice**: Strapi v5, **≥ 5.49.0**, Node ≥ 20, TypeScript
- **Plugins anticipated** (all **local plugins** inside the app, `src/plugins/*`):
  - `ingest` — webhook receiver for the mention source (Octolens), dedupe + normalize
  - `analysis` — sentiment scoring + topic clustering + AI draft generation, behind a **provider-agnostic AI interface**
  - `assistant` — chat-with-the-data Q&A / report generation
  - `notify` — Slack notifications
  - `pulse-mcp-tools` — custom MCP tools registered on the **official** built-in MCP server via `strapi.ai.mcp`
  - (No GraphQL, no i18n, no custom-field plugins)
- **Why**: requirements demand backend-heavy modules (ingestion, analysis, chat, notify) that bolt on independently; local plugins give module boundaries without package-publishing overhead.

## Database
- **Choice**: PostgreSQL (managed by Strapi Cloud); SQLite for local dev only
- **Why**: relational fits mentions/responses/topics/events; Strapi Cloud manages it; volumes (assumed low hundreds of mentions/day, ~1yr history) are trivial for Postgres.

## Backend hosting
- **Choice**: Strapi Cloud
- **Region / Plan**: nearest team region; plan sized at deploy time
- **Why**: zero-infra default; deploy on push. ⚠️ Constraint to verify in stage 5: long-running/async AI work must fit Strapi Cloud's execution model (no separate worker processes) — analysis runs in-request or via Strapi cron, not a job queue.

## Frontend framework
- **Choice**: **Next.js 16** (App Router, React Server Components)
- **Considered**: TanStack Start (also a fit for an authed app-style dashboard); Astro (rejected — this is an app, not a content site)
- **Why**: team choice; biggest ecosystem; RSC pattern fits a data-dashboard app; thin-client principle keeps Next.js swappable later.
- **Routes live in**: `app/` · **Public env prefix**: `NEXT_PUBLIC_`

## Frontend hosting
- **Choice**: Vercel
- **Why**: user choice; first-class Next.js hosting; env-var separation per environment.

## Auth
- **Choice**: **stock Users & Permissions** (Strapi built-in)
- **Providers enabled**: email/password (admin-invited accounts; no self-signup — registration disabled/closed)
- **Why**: internal tool, production-ready path, zero extra setup, matches Strapi Cloud deploy. Better Auth's social/SSO features not required; its beta status is unacceptable for a daily-driver team tool.
- **Roles**: `Authenticated` = team member (see everything, claim/respond); `Admin` handled by Strapi admin roles for configuration. Role model extensible via custom U&P roles later.

## Media / file storage
- **Choice**: Strapi Cloud media (default)
- **Why**: minimal media needs (possibly mention screenshots later); nothing to configure.

## CI/CD
- **Backend**: Strapi Cloud auto-deploy on push
- **Frontend**: Vercel auto-deploy on push

## Email / notifications
- **Choice**: **Slack incoming webhook** (from the `notify` plugin) for new/negative mentions. No email provider in v1.
- **Why**: the team lives in Slack; email adds provider setup with no v1 requirement.

## Payments
- **Choice**: n/a (internal tool)

## Analytics & monitoring
- **Choice**: none in v1 (internal tool); Sentry optional later.

## AI provider (sentiment, clustering, drafts, chat)
- **Choice**: **provider-agnostic interface** inside the `analysis`/`assistant` plugins; v1 ships against **Claude (Anthropic API)** as the primary provider. ⚠️ Primary-provider choice assumed from the user's prior work — confirm.
- **Grounding**: AI draft answers must be grounded in **official Strapi documentation** as the source of truth. Mechanism to evaluate in stage 5: Strapi's docs assistant is kapa.ai-powered — investigate the kapa.ai API vs. consuming a Strapi docs MCP server from the backend. Flagged as a stage-5 open item; do not hard-code a docs mechanism into the module boundary.
- **Why**: "framework agnostic" is a stated requirement; the abstraction keeps the provider swappable while shipping v1 against one real provider.

## MCP server (AI agent access)
- **Enabled**: **yes** — first-class requirement (external AI clients query mentions/sentiment/themes and generate reports)
- **Implementation**: Strapi **built-in** MCP server (GA since v5.49) — `mcp: { enabled: true }` in `config/server`; endpoint `POST /mcp`; authed with **scoped Admin API tokens** (least-privilege: read-only token for reporting clients; separate token if any write tools are exposed)
- **Custom tools**: registered from the `pulse-mcp-tools` local plugin via `strapi.ai.mcp` in `register()` (pattern per the official blog post + demo-store repo above) — e.g. sentiment-trend query, theme summary, report generation
- **Explicitly NOT**: a hand-rolled MCP transport (the old project's approach) — the official server is the base
- **Why**: replaces the legacy custom MCP with the supported surface; permission-gated by design.

## Search
- **Choice**: **Postgres full-text search** (tsvector over mention content + response text), exposed via a custom Strapi controller. **No external search engine** (Elasticsearch/Meilisearch) in v1.
- **Why**: at assumed volumes Postgres FTS is plenty; an external engine adds infra Strapi Cloud can't host. Revisit only if volume grows 10×.

## Data collection & replay (greenfield — decided)
- **No migration from the prior project** — data collection starts fresh at launch. Trends become meaningful as data accumulates; the UI ships proper empty states for the early weeks.
- **Replay**: any stored `raw` payload can be re-run through analysis (admin-triggered).
- **Dead letters**: webhook payloads that fail validation are stored raw with the error (never dropped) + ops alert; replayable once the parser is fixed.
- **Reconciliation**: ⚠️ open — whether Octolens exposes a pull/list API for gap-filling after webhook downtime. If yes, a periodic reconcile cron is a v1.x add; if no, dead-letter replay is the fallback.

## Observability & guardrails
- **Ops alerts**: a **second Slack webhook** (ops channel) for pipeline failures — analysis sweep errors, webhook secret-rejection spikes. The tool must never fail silently.
- **AI budget**: daily token counter (plugin store) with `AI_DAILY_TOKEN_BUDGET`; warn to ops Slack at 80%, halt non-essential AI work (nightly re-cluster) at 100% — analysis of new mentions always continues.
- **Trend integrity**: every analysis stamps `modelVersion` + `promptVersion`; human corrections are flagged and never overwritten by re-analysis.

## Styling
- **Choice**: Tailwind
- **Component library**: shadcn/ui (dashboard-friendly, fits Next.js + Tailwind)
