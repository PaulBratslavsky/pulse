# Field report: Strapi built-in MCP server (content-manager tools), 2026-07-28

Source: a real Claude (Desktop/Code) session working against Pulse's production Strapi 5.51 `/mcp`
endpoint using the **auto-generated content-manager tools** (the token carried content-manager
permissions in addition to Pulse's custom tools). Findings below are about **Strapi core's MCP
surface** — Pulse's own registry tools are unaffected (they return relation names, exclude `raw`,
and write single fields). Kept here as the raw material for upstream issues.

## Critical

### 1. Partial updates are impossible → silent data loss
`update_mention` requires `externalId` and `content` in `data` (the **create** schema's `required`
array appears to be applied to the **update** tool). Setting one field means resending the entire
post body. Real consequence in this session: a truncated `content` was sent and **silently
overwrote a 1,200-word Reddit post** — no diff, no warning, only discoverable by re-reading.
Fix: on update, every field should be optional. Single change; removes the failure mode; cuts
token cost per write ~80%.

### 2. No delete tool + unique constraints can deadlock rows
Two records carried the same `externalId` (duplicate ingest). The uniqueness validation then
rejected **any** update to either row (each blocked by the other), and no `delete_mention` tool is
exposed — both records were frozen with no workaround. Asks: expose delete (or a merge action);
make example flows idempotent on unique fields.

## High

### 3. Context economy
- `raw`-style large JSON fields ship on every record with no `fields`/`populate` parameter — on a
  25-record fetch the `raw` payload was most of the context cost. Exclude big fields by default,
  opt in explicitly.
- The `list_*` filter schema is enormous: every field × every operator, fully expanded inline —
  "the schema alone cost more than the data I was querying." Use `$ref` for the operator object or
  describe operators in prose.
- A `pageSize=25` fetch shouldn't be a significant fraction of a context window.

### 4. Relations come back as opaque IDs
```json
"channel": { "documentId": "yg9kl2pb1m9zdzif8w75nemy" }
```
Unusable without a second call (the agent inferred "reddit" from the URL instead). Include
`name`/`key`/`slug` on relation stubs.

## Medium

### 5. Two schema-generation bugs
- `filters: { draftText: { $notNull: true } }` fails validation — the generated schema types
  `$notNull` as the **field's own type** (string) instead of boolean. Likely affects `$null` on
  every field.
- `status` is serialized inconsistently (present in `list_mention`, absent from `get_mention` /
  `update_mention` responses) **and collides**: core's `status: "published"` (publish state) vs. a
  user-defined `status` attribute. Rename one in the MCP serialization (`publishState`?).

### 6. Tool discovery
`tool_search("list mentions pulse")` missed; plain `"mention"` hit. Auto-generated descriptions
("Content-manager list for api::mention.mention.") carry no semantic signal. Generate real
descriptions from the content-type (what it represents, when to reach for it, key filters).

## Worth adding
- Bulk update (18 sequential single-record writes for one logical operation).
- A first-class full-text search tool (vs. knowing to build `$containsi`).
- Conditional writes ("set only if currently null") so re-runs don't clobber human edits.

## What worked well
Filters/sort expressive and behaved as documented; `documentId` as the stable identifier is right
and clearly described; strapi-docs MCP grounding was genuinely useful (incl. Cloud vs CMS
licensing distinction).

## Pulse-side responses (already shipped)
- Duplicate ingest fixed at the root (real unique index + race-safe intake + sync overlap guard) —
  the frozen-row pair merges automatically at boot.
- `pulse-save-draft` is now a conditional write: refuses to replace an existing draft unless
  `overwrite: true` (returns the existing draft instead) — the "re-run clobbers human edits"
  failure mode is gone from our surface.
- Tool descriptions now state draft canonicality: pending drafts live on `mention.draftText`;
  a `Response` records only replies that were actually posted.
- Operating guidance: Pulse MCP tokens should carry **only** the "Pulse MCP tools" permission
  actions. Content-manager permissions additionally expose the generic CRUD tools above — that is
  how the body overwrite happened.

## Pulse-side responses, round 2 (2026-07-28, shipped)
Every critical/high item from the report now has a **Pulse-native tool** that avoids the
content-manager surface entirely (keep prod tokens scoped to "Pulse MCP tools" only):

| Report item | Pulse tool answer |
|---|---|
| Partial updates impossible → silent overwrite | `pulse-update-mention` — send ONLY changed fields; `content` is **not writable at all**, so the corruption path doesn't exist. |
| Enum/`$null` filters rejected; can't find undrafted | `pulse-queue` takes **semantic** filters (`draft: no-draft \| has-draft`, `status`, `sentiment`, `topic`, `search`) — no raw operator schema to get wrong, no `$null` on enums. |
| Context economy (raw duplicated, huge filter schema) | `pulse-queue` returns trimmed rows with `excerptChars` (default 400) + `page`/`limit`/`total`/`hasMore`; `raw` is never in tool output. |
| Relations as opaque IDs | Channel and topics come back as **names**, not documentIds. |
| Bulk update | `pulse-save-drafts-bulk` — up to 25 drafts per call, per-item results, same skip-unless-overwrite rule. |
| Conditional writes | `pulse-save-draft` / bulk refuse to replace an existing draft unless `overwrite: true`. |
| Duplicates deadlocking rows | Fixed at the root (unique index + boot merge). Verified on prod: `externalId p0axbn7` now resolves to **one** row. |
| Result too large | Wire-size guard (pattern from music-kb's MCP adapter): measures the **doubled** payload (content + structuredContent) and returns a structured `RESULT_TOO_LARGE` with a shrink hint instead of an opaque client error. |
| Discovery / weak descriptions | Every Pulse tool has a hand-written description saying what it's for and when to reach for it. |

Also added: `pulse-acknowledge` (close a competitor/off-topic mention without a public reply,
guarded by the same state machine as the app).
