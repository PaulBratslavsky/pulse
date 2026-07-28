# Architectural review — 2026-07-28

Method: 7 parallel dimension reviewers (backend modules, ingest/plugin, security/permissions,
frontend, data model, AI/tooling, testing/ops) read the codebase; 74 raw findings deduped to 73;
the 14 most significant were adversarially verified against the code (**14 confirmed/adjusted,
0 refuted** — several sharpened by the verifier). ~1.3M tokens of review, 530 file reads/greps.

## What's genuinely strong (keep doing this)

- **One intake path** for webhook + pull-sync (one dedupe, one channel/topic mapping, one activity
  trail, provenance stamped on every labeling path).
- **One tool registry** feeding MCP + the in-app assistant; per-tool permission actions;
  save-draft human-in-the-loop with an overwrite guard.
- **One Pulse-score implementation** consumed by REST, MCP, assistant, and the Slack digest.
- **Server-set-field discipline** everywhere (owner/status/author never from request bodies);
  user exposure whitelisted to id/documentId/username on every intentional path.
- **AI-optional is real**: every entry point gated, keyless labels carry provenance, skipped
  mentions catch up when a key appears, `humanCorrected` respected.
- **Fails loudly**: dead letters + ops alerts on malformed webhooks; crons wrap errors;
  plugin build hygiene correct (dist ignored, hooks wired, exports map verified).

## P0 — correctness fixes (do next; all verified in code)

1. ✅ **SHIPPED (573a1f4): MCP grants wiped every restart.** Permission actions registered in
   bootstrap ran *after* admin's cleanup pass, which prunes grants for unknown actions — every
   deploy silently revoked the per-tool checkboxes from admin tokens. Moved to `register()`;
   grants verified to survive restarts. **Re-check prod token boxes once after this deploy.**
2. **analysisSweep has no reentrancy guard or retry cap** (`sweep.ts`, cron `* * * * *`). Twenty
   sequential AI calls easily exceed 60s → overlapping runs double AI spend and duplicate
   activities/Slack posts; concurrent topic creation races turn into spurious `failed` states via
   the unique topic name. A global AI outage (bad key) = 20 ops pings/minute forever. Fix: the
   same `running` flag sync already has (wrap all of `run()`, keyless path included) + an
   `analysisAttempts` cap with one park alert.
3. **Sync loop: one bad mention poisons the run** (`sync.ts:73-115`). A deterministic per-item
   failure (e.g. >255-char `url`/`authorHandle` — Strapi validates string length everywhere)
   aborts the run, and since pages walk newest→oldest with no cursor persistence, everything
   *older* than the poison item is blocked until it ages out. Fix: per-mention try/catch →
   dead-letter + ops alert + `failed` count in the sync report; change `url`/`authorHandle` to
   `text` or truncate at intake.
4. **Dedupe merge orphans children and can self-brick** (`dedupe-mentions.ts`). Deleting a spare
   drops its activities/responses/comments link rows (losing team trail if both dupes had
   activity), and if the delete loop fails partway, the CREATE UNIQUE INDEX then throws on every
   boot — swallowed by the catch — leaving ingest permanently unguarded. Fix: re-parent children
   (incl. activities; carry owner/assignee/status) to the keeper before deleting; ops-alert on
   failure instead of a log line.
5. **Queue filter clearing is broken** (frontend, `app/page.tsx` filterUrl): the "all" sentiment
   chip and the topic ✕ can never clear their params (the `!== undefined` check defeats the
   `undefined` override). Extract a `buildQueueUrl(current, overrides)` helper using `'key' in
   over` semantics; add the missing filter e2e.
6. **State machine isn't enforced** — controllers apply transitions unconditionally (claim works
   on resolved mentions and silently reassigns; outcome on an *internal* response resolves the
   mention — that one is a one-line fix: require `!response.internal`). Fix properly with #P1-1.

## P1 — the refactor roadmap (in order)

1. **Workflow service + transition table + transactions** (combines three verified findings).
   Move claim/route/acknowledge/correct/replay/recordResponse/recordOutcome into
   `api::mention`/`api::response` services as `transition()`-style methods holding a transition
   table derived from docs/architecture.md's diagram, each wrapped in `strapi.db.transaction`
   (Document Service joins the ambient transaction; keep Slack outside). Controllers shrink to
   validation + ctx mapping; future MCP tools call the same methods. Note the verifier's caution:
   extract *when touched* — don't do a big-bang move.
2. **`ensure()` for topics/channels + more unique indexes.** Three call sites create topics with
   inconsistent matching ($eqi vs exact) and no race guard. Centralize into
   `topic.ensure(names, kind)` / `channel.ensure(key)` with $eqi + create-catch-refetch; extend
   the bootstrap util (rename → `ensure-db-constraints.ts`) with unique indexes on `topics.slug`
   and `channels.key`, plus hot-filter indexes: `mentions(status, posted_at)`,
   `mentions(analysis_status, received_at)`, `comments(archived)`.
3. **Query-shape hygiene before data grows**: split populate-mention into a lean list profile
   (channel/topics/owner + `comments: {count: true}`, no raw/activities) vs. the full detail
   profile; replace the snapshot/trends 10k-row JS reduce with SQL GROUP BY via knex (pattern
   already established in the bootstrap util).
4. **Frontend consolidation**: one typed `pulse-client.ts` (six divergent fetch helpers today);
   a shared wire-types module (39 `any`s across 11 files); split `timeline.tsx` (414 lines) into
   LinkListEditor/DiscussionCard/SystemEntry; promote repeated atoms (Avatar ×4, UserChip ×3,
   EmptyState ×6, FilterPill ×4); add `app/error.tsx` / `loading.tsx` / `not-found.tsx`; render
   error states for the four silent mutations in mention-actions.
5. **Ops polish (all small, all verified)**: gate intake Slack notifications on `postedAt`
   freshness (a 30-day backfill currently posts up to 1,500 Slack messages); surface
   `truncated` from MAX_PAGES-capped sync runs (backfills/post-outage recovery silently drop the
   tail today); redact `?secret=` from request logs (it's written on every webhook delivery) +
   `timingSafeEqual`; close the dead-letter loop (the sync path's malformed items are dropped
   with no record today; add `POST /api/dead-letters/:id/replay`).

## P2 — testing & assorted (verified or high-confidence)

- **MCP surface has zero test coverage** despite a real-world write incident: add a request-only
  Playwright spec (admin token with only pulse-* grants → tools/list + save-draft + the
  disabled-tool rejection). This would have caught the P0-1 grant-wipe bug.
- **vitest for the pure logic**: Pulse-score math, `octolensSentiment`, `competitorTopicNames`,
  `validateLinks`, `parseTimestamp`, webhook `normalize`.
- **CI never runs a production build** — add `next build` (and boot e2e from it).
- e2e gaps vs. the last day of features: insights snapshot, n/a label, feedback kind, has-draft
  filter, queue-filter URL state.
- Chat drops conversation history (multi-turn is an illusion) — pass the last N messages through.
- `mention.raw` should be `private: true` in the schema (defense-in-depth; it escapes via
  workflow-route responses today).
- Budget is warn-only for chat/draft — either enforce the documented 100% halt or fix the doc.
- Full backlog (30 unverified medium/high + 29 low) lives in the review run output; fold items
  into work as the area is touched.

## Refuted / non-issues
None of the 14 verified findings were refuted outright, but the verifier corrected several
framings (e.g. steady-state cron does NOT lose data at >2000 mentions/day — only backfills and
outage recovery do; "empty services" duplication was overstated — extract on second consumer).
