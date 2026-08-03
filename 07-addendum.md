# 07 — Addendum: Lead capture → HubSpot

> **Status: specced, not built.** Nothing in this document exists in the repo yet.
> **Hand this file to a coding agent alongside 06-build-spec.md.** It assumes 06's conventions
> (Strapi-native `src/api/<name>` folders, document service, no draft & publish, permissions
> seeded in `src/index.ts`).
> **Every HubSpot fact below was read from live docs on 2026-08-03 and NONE of it has been
> executed against a real portal.** Treat endpoints, property names and association IDs as
> researched-but-unverified. Sources are cited so they can be re-checked rather than re-found.

---

## Why this exists

Pulse routes mentions into a `lead` lane, scores their authors, and shows them on a board. That
is where it stops. A lead on the board is **interesting**, not **actionable** — nobody can reach
the person, and nothing leaves the app. This addendum specs the path from *interesting* to
*someone at Strapi can act on it today*, and the sync into HubSpot that follows.

## The core decision: identity is supplied, not matched

The obvious design is to take a social handle and hunt for the matching HubSpot contact. **Reject
it.** HubSpot dedupes contacts on `email`; Pulse holds a handle and a profile URL and no email on
any row. Handle-based matching means fuzzy search, a match rate nobody has measured (my estimate:
10–20%, near zero for pseudonymous Reddit/HN authors), and a long tail of handle-only orphan
contacts that can never merge with the real person when they eventually fill in a form. That last
failure is close to irreversible and is what makes revops teams kill integrations.

**Instead: a human supplies the email while qualifying the lead.** An email is not merely contact
info — it is the exact key HubSpot dedupes on, so `batch/upsert` with `idProperty=email` either
finds the existing contact or creates a clean one. The whole matching problem disappears, replaced
by ~30 seconds of human research that someone was going to do anyway before reaching out.

The consequence worth internalising: **the gap between Pulse and HubSpot is a workflow step, not
an algorithm.** Build the worksheet, not the matcher.

---

## What already exists — do NOT rebuild

Verified by reading the repo on 2026-08-03. A surprising amount of the "lead profile" idea is
already shipped:

| Capability | Where | Note |
|---|---|---|
| Person-scoped manual notes | `api::comment.comment` — has a `person` relation and `kind: note \| comment \| feedback` | Already rendered on the person page through the shared Timeline component |
| Lead lifecycle | `Person.status` `new → watching → contacted → qualified → not-a-fit`, `statusChangedAt`, `owner` | `leads.setStatus()`, `apps/cms/src/api/person/services/leads.ts:183` |
| Audit trail | `logActivity()` → `api::activity.activity` | `setStatus` deliberately skips no-op transitions so notes aren't buried |
| Intent evidence | `Mention.laneEvidence` (verbatim, verified server-side), `laneReason`, `leadDirection`, `leadContext.competitor` | **This is Pulse's unique asset — see below** |
| Leads board + detail UI | `apps/web/app/leads/page.tsx`, `apps/web/app/leads/[documentId]/page.tsx` (280 lines), `components/lead-status.tsx` | Already renders evidence and signals |
| Scoring | `leads.score()` / `persist()` / `rescoreAll()` | Pure arithmetic, no model calls |
| Outbound notification pattern | `apps/cms/src/api/notify/services/slack.ts` | env-configured, log-and-skip when unset, deep-links via `PULSE_APP_URL` — **copy this shape for HubSpot** |
| External OAuth 2.1 + PKCE MCP client | `api::mcp-server` + `services/mcp-server.ts` | Token persistence, refresh, and a `POST /mcp-servers/:id/test` prove-it button |

**What is actually missing is one thing: the contact-identity layer.** Who they are, where they
work, how to reach them.

### Pulse's unique contribution (shapes the whole payload)

Five things make a lead actionable. Pulse already produces two that a CRM structurally cannot:

| | Question | Source |
|---|---|---|
| 1 | Who are they | ⚠️ missing — build below |
| 2 | How to reach them | ⚠️ missing — build below |
| 3 | **Why now** | ✅ `laneEvidence` + post age |
| 4 | **What to say** | ✅ competitor, direction, topics |
| 5 | Who owns it | ✅ `Person.owner` |

So the value shipped to HubSpot is **not the contact record — it is the timestamped, verbatim
evidence**. The pitch is never "here's a lead"; it is *"here are their exact words, three days
old, saying they're leaving Contentful."* Build the payload accordingly: the quote is the product.

---

## Design principle: name the events in Pulse, make every transport a subscriber

Added 2026-08-03 after questioning whether HubSpot custom event types should drive the design.
They should not — but the underlying instinct is right and should be built.

Semantic events — *looking to migrate*, *leaving us*, *unhappy*, *asking a question* — are good
modelling for Pulse on their own terms. Pulse already **holds** every one of these facts; they are
just scattered across fields rather than named:

| Event | Already derivable from |
|---|---|
| Looking to migrate **to** us | `lane: lead` + `leadDirection: toward-us` + `leadContext.competitor` |
| Leaving us | `leadDirection: away-from-us` |
| Unhappy | `sentimentLabel: negative` + topics |
| Asking a question | `lane: respond` + `postKind` |

What is missing is not the data. It is a **named event emitted at the moment the fact becomes
true**, with subscribers. Build that — a single `emitSignal(kind, mention, person)` in the mention
services, writing an `Activity` row and fanning out — and every transport becomes a subscriber:

- **Slack** — today, free (M-L2)
- **HubSpot Note + contact properties** — M-L3
- **HubSpot app events** — later, *if* approval is ever granted; a new subscriber, not a rewrite

**Do not let HubSpot's event model dictate Pulse's**, particularly a model Pulse may never be
granted access to. Emitting the events is unconditionally useful; where they are delivered is a
detail that can change without touching the emitters.

---

## M-L1 — Lead profile (build this first, regardless of whether HubSpot ever happens)

### Why a component, not a new collection type

A separate `Lead` type would put lead data in a **third** place (Person + Comment + Lead) and
would have to be reconciled by hand whenever `Person.mergedInto` fires. A Strapi component matches
the existing `shared/outcome` convention, stores nothing until someone works the lead, and keeps
`Person` free of eight columns that 95% of rows will never use.

`apps/cms/src/components/shared/lead-profile.json`:

```json
{
  "collectionName": "components_shared_lead_profiles",
  "info": {
    "displayName": "Lead Profile",
    "description": "Human-supplied identity for a lead. Scoring says WHO is interesting; this says who they actually are and how to reach them. Email is the gate: without it a lead is not actionable and never syncs."
  },
  "attributes": {
    "email":          { "type": "email" },
    "company":        { "type": "string" },
    "companyDomain":  { "type": "string" },
    "role":           { "type": "string" },
    "intentSummary":  { "type": "text" },
    "intentDrafted":  { "type": "boolean", "default": false },
    "researchedBy":   { "type": "relation", "relation": "oneToOne", "target": "plugin::users-permissions.user" },
    "researchedAt":   { "type": "datetime" },
    "hubspotContactId": { "type": "string" },
    "syncedAt":       { "type": "datetime" },
    "syncError":      { "type": "text" }
  }
}
```

Then on `apps/cms/src/api/person/content-types/person/schema.json`:

```json
"leadProfile": { "type": "component", "repeatable": false, "component": "shared.lead-profile" }
```

Sync state (`hubspotContactId`, `syncedAt`, `syncError`) lives here rather than on `Person`
because the component exists exactly when a human has worked the lead — which is exactly when a
sync is possible. One row, one lifecycle.

`intentSummary` should be **AI-drafted from the person's lead-lane mentions and human-editable**,
mirroring `humanCorrected` on Mention. `intentDrafted` records provenance so it is later possible
to tell whether anyone trusts the drafts.

### API surface

- `PUT /people/:documentId/lead-profile` → new handler `person.saveLeadProfile`
  - sets `researchedBy` / `researchedAt` from `ctx.state.user` on first write
  - logs an activity (new action type — see trap below)
- `POST /people/:documentId/draft-intent` → drafts `intentSummary` from lead-lane mentions
- Add `leadProfile: true` to the populate in **both** `person.detail` and `person.leads`
  (`apps/cms/src/api/person/controllers/person.ts`)

### UI

On `apps/web/app/leads/[documentId]/page.tsx` — an editable panel above the timeline. A
**readiness indicator** is required, so the sync gate is never mysterious:

```
✓ email   ✓ qualified   → Ready to sync
⚠ no email              → Add an email to make this actionable
```

**Done when**: a human can open a lead, add email/company/role/notes, see readiness flip, and the
values survive a reload. No HubSpot code exists yet.

---

## M-L2 — Slack handoff (the cheap experiment that gates everything after it)

~30 lines in `apps/cms/src/api/notify/services/slack.ts`, following `newMention`/`pingAssignee`.
Fires on transition to `qualified`. Carries: `laneEvidence` verbatim, channel, direction,
competitor, email, company, profile URL, and the Pulse deep link.

This exists to answer the **second unmeasured assumption, which is the larger risk: does anyone at
Strapi actually work social leads?** `01-product.md` names DevRel, support and product as the
users — sales is not in the document. Leads are a lane, not the mission.

**Done when**: three weeks of real transitions have posted to `#pulse-leads` and someone has
counted how many were acted on. **If that count is ~0, stop. Do not build M-L3.** A CRM
integration nobody works is pure maintenance cost.

---

## M-L3 — HubSpot sync

### The event

**`status → qualified` AND `leadProfile.email` present.** Both conditions. Hook it in
`leads.setStatus()` (`apps/cms/src/api/person/services/leads.ts:183`) beside the existing
`logActivity` call.

Why this gate and not the score:

- **It cannot create an orphan contact by construction**, not by policy. No email → no code path
  that writes. Unreachable rather than merely discouraged.
- **The two conditions are different assertions.** Email = technically actionable. Qualified = a
  human vouched. Adding an email is research, not endorsement — require both.
- **The asymmetry favours caution.** Syncing too eagerly pollutes a CRM semi-permanently; syncing
  too late means someone clicks a button.
- **Never gate on `leadBand`.** `leads.ts:84` records what happened when the machine decided:
  168 "leads" out of 200, including a Strapi employee. Survivable inside Pulse; permanent damage
  inside someone's CRM.

⚠️ **Interaction with the hand-captured-lead invariant (2026-08-03).** Routing a mention to `lead`
by hand cannot mint `laneEvidence`, so a hand-captured lead scores `watch`/`warm` and **never
`hot`**. Any band-based gate would therefore silently exclude exactly the leads a human cared
enough to capture manually. The `qualified` + email gate is immune to this — keep it that way.

Rules:
- `not-a-fit` never syncs. If an already-synced lead later becomes `not-a-fit`, **stop updating
  but do not delete** — sales may have built on that record.
- Re-sync on subsequent qualifying mentions appends a Note; it never duplicates the contact.

### What gets written

1. **Contact** — `POST /crm/v3/objects/contacts/batch/upsert` with `idProperty=email`.
   Custom properties (create once via `/crm/v3/properties/contacts`):
   `pulse_person_id`, `pulse_profile_url`, `pulse_lead_score`, `pulse_lead_band`,
   `pulse_intent`, `pulse_last_mention_at`, `pulse_url`.
2. **Note** — the evidence artifact, associated to that contact.

Structured/filterable data goes on the **Contact**, not the Note: contact properties drive lists,
workflows and reports, and custom properties on the Notes object have historically lagged behind
calls/meetings ([community thread](https://community.hubspot.com/t5/Reporting-Analytics/Create-Custom-Property-on-Notes-engagement-object-Report-on/m-p/507209)).
The Note is what a human reads; the properties are what sales segments on. Don't make one field
do both.

```ts
// POST https://api.hubapi.com/crm/v3/objects/notes
{
  properties: {
    // when they SAID it, not when we synced — the timeline is a chronological
    // record, and "they said this today" about a May post is a lie in the one
    // place people trust. Cost: backfilled mentions land deep in the timeline.
    hs_timestamp: mention.postedAt ?? mention.receivedAt,
    hs_note_body: html,                       // HTML supported, 65,536 char cap
    hubspot_owner_id: ownerId,                // from /crm/v3/owners — NOT a user id
  },
  associations: [{
    to: { id: hubspotContactId },
    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
  }],
}
```

Note body: bold header with band + score, `<blockquote>` of `laneEvidence`, channel/direction/
competitor line, signal labels, then **two links — the original post and the Pulse lead page**.
The deep link is what makes the note useful rather than noise.

### Module layout

```
apps/cms/src/api/hubspot/services/
  client.ts       # bearer token, 429 + Retry-After backoff, log-and-skip when env unset
  contacts.ts     # upsertByEmail(), property bootstrap
  engagement.ts   # noteFromMention() — payload builder
  sync.ts         # orchestration; called from setStatus + cron backfill
```

Env: `HUBSPOT_TOKEN`, `HUBSPOT_PORTAL_ID`, `HUBSPOT_OWNER_MAP` (Pulse username → HubSpot owner id).
Missing env → log and skip, exactly like `slack.ts`, so local dev works untouched.

**Reliability**: failures → the existing `dead-letter` collection (`raw`, `error`, `resolved`,
replayable — described as webhook-inbound but the shape fits outbound retries unchanged). Drain
via a `config/cron-tasks.ts` entry using the same overlap guard as `plugins/octolens/.../sync.ts`.

**Idempotency**: `leadProfile.hubspotContactId` for the contact, and store the returned note id
per mention before considering the write done. HubSpot has **no idempotency key on notes** — a
naive cron retry silently duplicates them forever.

**Done when**: qualifying a lead with an email produces exactly one contact and one note in a real
portal, re-qualifying does not duplicate, and a forced failure lands in `dead-letter` and replays.

---

## Traps

1. **Never write `lifecyclestage`.** It is forward-only; moving backwards requires setting `""`
   first, which **destroys the contact's stage history**. Use `pulse_*` properties.
2. **Search API is 5 req/s shared across the entire portal** — not per app, not per object type.
   A naive backfill loop starves every other integration Strapi runs. Batch (100/request for
   contacts and notes) and back off.
3. **`hubspot_owner_id` ≠ user id.** Fetch owners from `/crm/v3/owners` and keep a map.
4. **`associationTypeId` is an integer.** Note→contact `202`, →company `190`, →deal `214`,
   →ticket `228`. The Notes reference mentions a snake_case form; the associations guide is
   unambiguous about integers — use integers.
5. **Base URL is `https://api.hubapi.com`.** Not `hubapi.com`.
6. **New `Activity.action` values need a schema change.** The enum is fixed —
   add `lead-researched` and `lead-synced` to
   `apps/cms/src/api/activity/content-types/activity/schema.json` or `logActivity` will reject them.
7. **New routes 403 until seeded.** Add every new handler to the permissions list in
   `apps/cms/src/index.ts` — a fresh Strapi denies all actions for both roles (06, M3).
8. **The leads board filters `leadScore: { $gt: 0 }`.** A person qualified purely by hand with no
   lead-lane mention scores 0 and would be **invisible on the board it was captured from**.
   Decide at build time: either widen the filter to `$gt: 0 OR leadProfile != null`, or only allow
   lead profiles to be created from an existing board row. Recommend the former.
9. **Naming.** Pulse's `Activity` is a system audit trail; HubSpot's is a customer engagement.
   Call the module `hubspot`/`engagement`, never `activity`.

---

## Closed and gated doors

Investigated 2026-08-03, **revised 2026-08-03 after a second pass** — the first pass called App
Events structurally impossible, which was wrong. It is gated by application, not closed. The
distinction matters and is drawn below.

The failure mode this section exists to prevent: **Timeline Events looks like the perfect fit for
Pulse** — structured custom events, typed tokens, custom rendering on a contact timeline. That
reading is *correct*; event types genuinely are fully user-defined ("evaluating a migration",
"expressed frustration", "asked a question" are exactly the intended shape). The blocker was never
what an event **is**. It is who may define one, and on what kind of app.

| Path | Real status |
|---|---|
| **Timeline Events v1/v3** | **Genuinely closed.** *"only available for app partners with **existing** v1/v3 timeline events"*; new event types cannot be created on v1/v3 at all; *"developer API keys and private app access tokens **cannot** be used"* for event creation. No application process. [ref](https://developers.hubspot.com/docs/api-reference/legacy/crm/extensions/timeline/guide) |
| **App Events** (Projects 2025.2 / 2026.03) | **Open by application — still BETA.** *"requires approval from HubSpot to use… to apply for app events access, you can submit an in-app form."* Positioned for technology partners, so approval is discretionary, but it is a form, not a wall. Cost below. [ref](https://developers.hubspot.com/docs/apps/developer-platform/add-features/app-events/create-and-manage-event-types) |
| **Private app doing timeline events** | **Immovable.** *"Private apps do not support custom timeline events… you should create a public app instead."* This is what Pulse is today, and this part does not bend. |
| **Custom behavioral events** (`/events/v3/send`) | Needs no app, but requires **Marketing Hub Enterprise** and is keyed by **email or `utk`** — the same identity wall, and Pulse has neither at ingest time. |
| **Auto-creating contacts from handles** | Orphan records that can never merge. Semi-irreversible; kills sales trust. |
| **Machine-triggered sync (`leadBand: hot`)** | See `leads.ts:84`. Also excludes hand-captured leads by construction. |
| **The `leads` object** | Requires `hs_lead_name` + a mandatory contact association (type `578`). Buys nothing over Notes unless the team actually works the Leads workspace. Revisit only if they do. |
| **MCP for the deterministic pipeline** | An LLM that syncs 94% of the time is worse than one that never does — you will trust it. No batch, no retry semantics, no dead-lettering, can't render a badge server-side. |

### What the App Events path would actually cost

Because Pulse is a private app and private apps cannot do timeline events, "yes" means building a
**second artifact** alongside the Strapi monorepo:

1. A HubSpot developer account, and a **Projects-based public app** with event types declared as
   `*-hsmeta.json` files under `src/app/app-events/`
2. An in-app application to HubSpot, approved at their discretion, for a BETA feature positioned
   for technology partners
3. Unlisted distribution, installed into Strapi's own portal (25-install cap — irrelevant for one)
4. OAuth install flow to mint the token; app events cannot use a private app token
5. Ongoing: a platform version every ~6 months on an 18-month support window, and event-type
   changes re-enter review

Against a private app token and a `POST`, which works the same afternoon. **The honest summary is
"a real project with a discretionary approval risk, in exchange for better rendering" — not
"impossible".** If someone wants to spend that, the application form is the first step and costs
nothing to submit.

**Crucially, none of it changes M-L1.** App events still attach to a contact by `objectId` or
email. A beautifully-rendered custom event still cannot be placed on a timeline without knowing
*which* contact. **The identity problem is upstream of the transport question**, so the lead
profile is the right first build under every branch.

**What Notes + contact properties recover anyway**: typed/filterable data → custom **Contact**
properties (better than timeline tokens for lists and workflows regardless). Human-readable
timeline entry → the Note. Idempotency → Pulse-side ids. **Not** recoverable: a custom icon and a
distinct filterable activity type. That is the entire delta being argued over.

### Still worth having: the HubSpot MCP server

`https://mcp.hubspot.com` went GA 2026-04-13 — OAuth 2.1 + PKCE, read/write on contacts and
engagements. Pulse's existing `api::mcp-server` already speaks exactly that. Register it from
Settings and hit **Test**.

This is **not** the sync mechanism. Its value is the *lookup assist* inside the lead profile
("search HubSpot by name or company") when a researcher is trying to find an existing contact,
plus ad-hoc questions in chat. Human-supervised, non-deterministic — the right side of the line
drawn in the table above.

Two things to check on first connect: (a) HubSpot's setup docs describe pre-creating a user-level
app, which suggests **no dynamic client registration** — Pulse's `DbOAuthProvider` attempts DCR
when `clientId` is absent, so `clientId`/`clientSecret` may need seeding on the row; (b) if the
portal has **sensitive data** turned on, Activity objects are blocked over MCP entirely.

---

## Open questions for a human — answer before M-L3

1. **Does a Strapi HubSpot portal exist, who administers it, and what tier?** Tier sets the rate
   limits (100–190 calls/10s; 250k–1M/day) and whether the Leads object is even available.
2. **Is there a named person who will work these leads?** M-L2 is designed to answer this
   empirically. If the answer is nobody, M-L3 should not be built.
3. **GDPR / lawful basis.** Strapi is French. A public post is public, but re-housing a named
   person's words *plus a researched email* in a CRM for sales purposes is a distinct processing
   purpose. Cheap to ask now, expensive to unwind. Blocks M-L3 only — M-L1 and M-L2 are internal.
4. **Owner mapping** — match Pulse users to HubSpot owners by email, or maintain an explicit map?
5. **Does `intentSummary` get drafted by AI on demand or on qualification?** On-demand is cheaper
   and keeps the daily token budget predictable; recommend on-demand behind a button.
6. **Do we want to submit the App Events application?** Costs nothing to file and the answer is
   useful either way. Only worth pursuing the build if approval lands *and* someone wants custom
   timeline rendering badly enough to maintain a second deployable public app. Not a blocker for
   anything in M-L1–M-L3.

---

## Build order

| | Gate to proceed |
|---|---|
| **M-L1** lead profile component + UI | none — build it; useful standalone |
| **M-L2** Slack handoff on `qualified` | M-L1 in use — people are actually filling in emails |
| **M-L3** HubSpot sync | M-L2 ran 3 weeks and leads were acted on, + open questions 1 & 3 answered |

M-L1 is worth building whether or not HubSpot ever happens: it turns the leads board from a list
of interesting strangers into a worksheet that makes the next action obvious.
