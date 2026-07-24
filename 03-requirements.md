# Functional Requirements

## Core features (MVP)
- Mentions from social channels flow into Pulse automatically (pushed from the mention-detection source) — no manual entry for normal operation.
- Every mention gets a **sentiment score/label** computed by Pulse (Pulse is the analyzer/aggregator; sentiment does not arrive pre-computed).
- Mentions are grouped by **topic/theme** (specific feature, bug, docs gap, competitor comparison) so patterns surface without reading every mention.
- A shared **unanswered-mentions queue**: any teammate can see unclaimed mentions, **claim** one, or **route/flag** it to the right owner (DevRel / Marketing / Product).
- Pulse generates an **AI draft answer** for a mention, grounded in official Strapi documentation as the source of truth; a human reviews/edits the draft.
- Teammates reply **manually on the platform** where the mention happened, then record in Pulse: what was replied, by whom, when, plus notes.
- **Outcome tracking** per response: how it landed (e.g., resolved/positive turn/no reaction/escalated) — building a library of responses that work.
- **Sentiment over time**: trend views that show shifts and support tying them to releases, launches, or incidents (events annotated on the timeline).
- **Recurring pain → product feed**: recurring themes surface as a structured, evidenced feed the product team reviews for roadmap input.
- **Shared dashboard**: the whole team self-serves the queue, trends, and score — nobody waits on a manual report.
- **Chat with the data**: teammates ask natural-language questions about mentions/sentiment/themes and get answers and generated reports.
- **Slack notifications**: the team is notified in Slack of new mentions (with priority on negative/spicy ones); every notification deep-links to the mention in Pulse.
- **Fresh data, nothing lost**: data collection starts greenfield (no migration from the prior project — decided). Raw payloads are kept so any mention can be **replayed** through analysis, and malformed/unrecognized webhook payloads are stored as **dead letters** (with an ops alert) instead of being dropped.
- **A defined sentiment score**: the headline score is computed by one documented, stable formula (not an ad-hoc average) so the number can settle roadmap arguments instead of starting them.
- **Human correction**: teammates can correct a wrong sentiment label or topic assignment; corrections are marked human-set and are never overwritten by re-analysis. Corrections double as evaluation data for improving the prompts.
- **Trend integrity**: every analysis records which model/prompt version produced it, so provider or prompt changes never masquerade as sentiment shifts.
- **Full-text search** across mentions and responses — "have we seen this before / what did we say last time" is a first-class action.
- **Person-level routing**: a mention can be assigned to a specific teammate (not just a team), and the assignee is pinged in Slack.
- **Aging / SLA visibility**: the queue makes stale unanswered mentions loud (age-sorted, staleness flags) and a daily Slack digest lists what's been sitting too long.
- **Activity trail**: every workflow transition (ingested, claimed, routed, corrected, answered, resolved) is logged with who and when — the "full data trail" is queryable, not implied.
- **Operational alerting**: pipeline failures (analysis sweep errors, webhook auth-rejection spikes) alert the team in a Slack ops channel — the tool never fails silently.
- **AI budget guard**: daily AI token spend is tracked against a budget with a Slack warning before it's blown.

## Account & auth
- End-user accounts: **yes** — every teammate has their own login (attribution of claims/responses depends on identity).
- Editorial admin accounts: **yes** — an Admin (Paul) manages accounts, categories/topics, events, and configuration.
- Roles needed: start simple — **Member** (everyone sees everything, can claim/respond) + **Admin**. The role model must be **extensible** (new roles/permissions as use cases emerge, without redesign).
- No public/anonymous access — internal tool, everything behind login.

## Content the product manages

### Editorial content (managed in Strapi admin)
- **Event**: a release, launch, or incident with a date — annotates the sentiment timeline.
- **Topic/Theme taxonomy**: the categories mentions cluster into (admin can curate/rename/merge).
- **Channel/Source**: the social platforms mentions come from.

### User-generated content (created via API / by the system)
- **Mention**: a social mention — content, author handle, platform, URL, timestamp, computed sentiment (+ human correction flag, model/prompt version), assigned topics, status (unanswered/claimed/answered/resolved), owner/assignee.
- **Response**: what was replied to a mention — text, who replied, when, notes, outcome; linked to its mention. Includes the AI draft it started from (draft vs. final).
- **AI draft**: generated answer suggestions awaiting human review (may be modeled as part of Response).
- **Activity entry**: system-written log line per workflow transition (who, what, when) attached to a mention.

### Reusable shapes (likely Strapi components)
- **Outcome record** (result + notes + date): appears on responses; possibly reused on mentions for status history.
- **Source metadata** (platform, external id, URL, author handle): appears on mentions; same shape any future source would use.

### Flexible layouts (likely Strapi dynamic zones)
- None identified — Pulse is a data/insight tool, not a page-builder product.

## Localization & drafts
- Multi-language (Strapi i18n): **no** — the tool's UI/content is English; mentions are stored as-is in whatever language they arrive. (Multi-language *sentiment analysis* quality is noted as a risk, not an i18n requirement.)
- Draft & publish: **no** for mentions/responses (workflow status is modeled explicitly instead). Not needed for events/taxonomy either.

## Integrations
- **Mention source (inbound)**: receive mentions pushed from the mention-detection service the team already uses — must tolerate duplicates and out-of-order delivery.
- **AI analysis**: compute sentiment, cluster topics, generate draft answers, and power data-Q&A — via an AI provider (must be provider/framework-agnostic; stage 4).
- **Strapi documentation as source of truth**: draft answers must be grounded in official Strapi docs (docs-lookup integration; stage 4 for mechanism).
- **Slack (outbound)**: send notifications for new/negative mentions.
- **AI agent access**: external AI agents/clients can read and act on Pulse data (see MCP below).

## AI / agent access (MCP)
- AI agent / assistant reads or writes content: **yes** — this is a first-class requirement, in two directions:
  1. **Inside Pulse**: AI computes sentiment/topics, drafts answers grounded in Strapi docs, and answers natural-language questions about the data.
  2. **Outside Pulse**: AI clients (e.g., Claude) connect to Pulse to query mentions/sentiment/themes and generate reports.
- → Candidate for Strapi's built-in MCP server (GA since v5.49); the enable/decision and architecture land in stage 4.

## Non-functional requirements
- Performance: queue and dashboard load fast enough for daily-driver use; trend queries over a year of data return in seconds.
- Scale: **assumption — low-to-mid hundreds of mentions/day, rolling ~1 year of history** for trends (⚠️ unconfirmed; verify and correct — affects nothing structurally at this size).
- Security: everything behind authentication; internal tool; API tokens scoped least-privilege; no PII beyond public social handles/content.
- Compliance: none identified (public social data + internal team accounts).
- Extensibility: **the app is built in modules** — capabilities (ingestion, analysis, chat, notifications) should be separable so new use cases bolt on without redesign (architecture in stage 4).

## Out of scope for MVP
- **Auto-posting replies to social platforms** — v1 drafts + manual reply; social-provider automation is a future phase.
- **AI auto-responding without human review** — drafts always pass through a human.
- **Multi-tenancy / other companies using Pulse** — pinned in stage 1, never in scope.
- **Public-facing pages** — internal only.
- **Consciously deferred** (discussed, cut from v1): rate-limiting the ingest endpoint · CSV export · a staging environment · automatic outcome detection (how a reply landed stays human-recorded).
