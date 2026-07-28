# Pulse — Architecture

Pulse is a single-instance internal tool: it aggregates social mentions of Strapi (via Octolens), tracks sentiment and the team's response trail, and turns recurring signals into product insight. One Strapi v5 backend owns all data and integrations; a Next.js frontend is a thin, replaceable view layer.

```mermaid
flowchart LR
  subgraph external [External]
    OCT[Octolens API v2]
    SLACK[Slack webhooks]
    ANTH[Claude API]
    MCPC["MCP clients\n(Claude Desktop / Code)"]
  end

  subgraph cms ["apps/cms — Strapi v5 (owns everything)"]
    PLG["octolens plugin\nwebhook + pull-sync + admin UI"]
    SWEEP["analysis sweep (cron)\nAI optional"]
    REG["tool registry\nsrc/tools/registry.ts"]
    MCP["built-in MCP server (/mcp)"]
    CHAT["assistant service\n(Claude tool-use loop)"]
    API["REST API + workflow routes\n(U&P JWT)"]
  end

  subgraph web ["apps/web — Next.js 16"]
    UI["queue / detail / trends / themes / insights / chat"]
  end

  OCT -- "webhook (blocked upstream)\n+ cursor pull-sync every 5 min" --> PLG
  PLG --> SWEEP
  SWEEP -- notifications --> SLACK
  REG --- MCP
  REG --- CHAT
  CHAT --- ANTH
  MCPC -- admin token --> MCP
  UI -- "per-user JWT (httpOnly cookie)" --> API
```

## Monorepo layout

| Path | What it is |
|---|---|
| `apps/cms` | Strapi v5 backend — all business logic, integrations, crons, MCP |
| `apps/cms/src/api/*` | Feature modules (mention, response, topic, analysis, search, assistant, notify, …) — plain `src/api` folders by default |
| `apps/cms/src/plugins/octolens` | Local plugin (sdk-plugin layout) — the one module that earned plugin-hood: it ships an admin UI (sync page + widget) |
| `apps/cms/src/tools/registry.ts` | **Single tool registry** consumed by both the MCP server and the in-app assistant |
| `apps/cms/src/mcp` | Registers registry tools on the built-in MCP server + their admin permission actions |
| `apps/web` | Next.js 16 App Router frontend (Epic Next auth pattern, DevFlow-style UI) |
| `apps/web/e2e` | Playwright suite (17 tests) — injects data through the real webhook |
| `0*.md` | The six-stage product spec (living docs; `06-build-spec.md` carries the revision log) |

## Data model

- **mention** — one social post. `externalId` (dedupe), content/author/url/postedAt, `channel`, sentiment (`sentimentLabel`, `sentimentScore`, provenance via `modelVersion`/`promptVersion`, `humanCorrected`), workflow `status`, `acknowledgeReason`, `topics` (m2m), pending `draftText`/`draftedAt`/`draftedVia`, `raw` (original payload, never exposed via API).
- **response** — what the team replied (or an `internal: true` note that never leaves the team). `finalText`, `draftText`, `notes`, outcome component.
- **activity** — append-only audit trail per mention (`ingested`, `analyzed`, `claimed`, `routed`, `corrected`, `answered`, `resolved`, `replayed`, `acknowledged`, `noted`, `drafted`).
- **topic** — theme mentions cluster into (`kind`: feature/bug/docs/competitor/other). Machine-created (AI clustering or competitor auto-tagging), admin-curated, and mintable inline from the labeling panel.
- **channel / event / dead-letter** — platforms, annotated timeline events, and failed webhook payloads (nothing is silently dropped).

### Mention workflow

```mermaid
stateDiagram-v2
  [*] --> unanswered: ingested
  unanswered --> claimed: claim
  claimed --> answered: record public reply
  unanswered --> answered: record public reply
  answered --> resolved: outcome resolved
  unanswered --> acknowledged: acknowledge (no reply)
  claimed --> acknowledged: acknowledge (no reply)
```

`acknowledged` closes a mention **without** a public reply (reason: `competitor` / `not-relevant` / `watching`) — it leaves the queue but keeps full analytics value, because trends/themes key off `analysisStatus`, not workflow status. Internal notes (`response.internal`) record team commentary at any point without changing status.

## Ingestion (all Strapi-side, by design)

Two paths share one intake service (`plugins/octolens/server/src/services/intake.ts`) — same dedupe, channel mapping, and activity trail:

1. **Pull-sync (primary)** — cursor-paginated `POST /api/v2/mentions`, cron every 5 min (`OCTOLENS_SYNC_CRON`), manual "Sync now" in the plugin's admin page. Filters `relevance !== 'irrelevant'`.
2. **Webhook (ready, blocked upstream)** — `POST /api/octolens/ingest` guarded by a shared secret (`x-pulse-secret` header or `?secret=`). Octolens' URL validator currently false-positives on Strapi Cloud's Cloudflare IPs (bug reported); the endpoint is live and verified.

Competitor signal is captured at intake: Octolens' `tags: ["competitor_mention"]` / `keywords[].keywordTag: "competitor"` auto-create and attach `kind: competitor` topics (e.g. `#Payload`).

## AI is optional — never faked

Everything except three features works with no AI key. With `AI_API_KEY` unset:

- Sentiment: Octolens' own label is adopted at intake with explicit provenance (`modelVersion: 'octolens'`, `promptVersion: 'label-map-v1'`, coarse score map ±0.5); otherwise mentions are marked `skipped` for manual labeling.
- Drafts and chat are cleanly disabled (503 / hidden UI), not degraded with heuristics.
- Adding a key later auto-analyzes previously skipped mentions via the cron sweep; human corrections are never overwritten.

**The Pulse score** (single implementation in `api::analysis.insights`): per UTC day, the volume-weighted mean of `sentimentScore` over a trailing 7-day window, scaled to 0–100 via `(mean + 1) × 50`.

## One tool registry, two AI surfaces

`src/tools/registry.ts` defines each tool once — name, description, zod v4 input schema, handler. Consumers:

- **Built-in MCP server** (`/mcp`, GA since Strapi 5.49) — `src/mcp/index.ts` loops the registry in `register()`.
- **In-app assistant** (`api::assistant.answer`) — a Claude API tool-use loop; `z.toJSONSchema()` bridges the same schemas to the Messages API.

Tools: `pulse-queue`, `pulse-get-mention` (context + similar past replies), `pulse-save-draft` (write), `pulse-search-mentions`, `pulse-trend-summary`, `pulse-theme-report`. The draft loop is human-in-the-loop by construction: agents save `draftText`, the queue shows a "draft ready" chip, the reply form pre-fills, a human posts on the platform and records the real reply (which consumes the draft). **Nothing auto-posts.**

## Permissions model (three registries, kept distinct)

| Surface | Mechanism | Where it's managed |
|---|---|---|
| Frontend users | U&P role permissions, seeded idempotently in `src/index.ts` bootstrap (registration closed; accounts admin-invited) | code (seed list `AUTHENTICATED_ACTIONS`) |
| MCP tools | One admin permission action per tool (`api::pulse-mcp.<tool>`), registered in bootstrap — a tool's action is its **only** gate | Admin Token screen → Settings tab → "Pulse MCP tools" checkboxes |
| Octolens plugin admin UI | `plugin::octolens.settings.read` / `plugin::octolens.sync.start`, gating routes, menu link, and widget | Roles / Admin Token screens → Plugins tab → octolens |

User data exposure is deliberately minimal: only `/api/users/me` is exposed; user relations in API responses are whitelisted to `id`/`documentId`/`username` (Strapi's sanitizer strips U&P relations entirely, so controllers re-shape explicitly).

## Scheduled jobs

| Cron | Default | Purpose |
|---|---|---|
| `analysisSweep` | every minute | analyze `pending` mentions (or apply Octolens labels keyless) |
| `octolensSync` | every 5 min | pull-sync reconciliation |
| `nightlyRecluster` | 03:00 | AI topic clustering (no-op keyless; corrections preserved) |
| `staleDigest` | 09:00 weekdays | Slack digest of stale unanswered mentions (`STALE_AFTER_DAYS`, default 2) |
| `budgetReset` | midnight | resets the AI daily token budget |

## Testing & CI

Playwright e2e (17 tests) runs against real dev servers with data injected through the actual webhook — sign-in once via storageState, tests are data-volume independent. CI (`.github/workflows/ci.yml`) boots the full stack keyless (AI-optional is exercised on every run) and runs the suite.
