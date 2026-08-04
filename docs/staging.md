# Staging

## What staging is for

CI already boots the whole stack and runs the e2e suite on every push, against a
fresh demo seed. That catches functional regressions better than clicking around
would, and it is why staging is **not** the place to re-test features.

Staging exists for the one thing CI structurally cannot cover: **CI runs SQLite,
production runs Postgres.** Schema sync, migrations and query behaviour differ
between the two, and a destructive migration verified only on SQLite is verified
only on SQLite. Phase B of the Person/SocialAccount split is exactly that shape
of change, and exactly what staging should absorb first.

The frontend is a lesser case. Deploy it so someone can look at a real corpus
and so the Vercel env wiring is proven, not to test behaviour the suite covers.

## Setup

**Backend — Strapi Cloud** (Environments → Add a new environment)

| Field | Value |
|---|---|
| Environment name | `pulse-staging` |
| Git branch | **`staging`** — never `master` |
| Base directory | `apps/cms` |
| Deploy on push | yes |
| Import variables from | production — it copies the NAMES with blank values, which is what you want |

Pointing staging at `master` would deploy the same commit to both, so staging
could never tell you anything before production did. Merge `master → staging`
to promote, or push work to `staging` first.

**Frontend — Vercel**

Root directory `apps/web`, git branch `staging`, and
`NEXT_PUBLIC_STRAPI_URL` set to the staging Strapi Cloud URL. Then add the
staging frontend origin to `strapi::cors` in
`apps/cms/config/middlewares.ts` or the app will fail every request with a CORS
error that looks like an auth bug.

## Environment variables

The defaults are deliberately safe: every integration no-ops when its key is
absent, so an unset variable disables a feature rather than breaking a boot.

| Variable | Staging | Why |
|---|---|---|
| `OCTOLENS_API` | **unset** | The single most important one. With a key, staging pulls the same feed as production — double-counting mentions, burning quota, and competing for the same records. |
| `OCTOLENS_WEBHOOK_SECRET` | a different value | Otherwise a production webhook can post into staging. |
| `SLACK_WEBHOOK_URL`, `SLACK_OPS_WEBHOOK_URL` | unset, or a test channel | Staging must not page the team. |
| `PULSE_APP_URL` | the staging URL | It is what deep links in Slack messages and notes are built from — wrong value and staging links send people into production. |
| `AI_API_KEY` | unset, or a separate key | The daily token budget is per-environment; sharing a key means staging can exhaust production's classification budget. |
| `PULSE_SEED_DEMO` | `true` | Seeds a corpus on first boot. No-ops once the database has mentions, so it cannot overwrite anything. |
| `NEXT_PUBLIC_PULSE_ENV` | `staging` | Shows the non-production banner. Set it on the **Vercel** project, not Strapi. |
| `APP_KEYS`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` | fresh values | Never copy secrets between environments. |

## Data

**Never point staging at production data**, and never let it consume the live
Octolens feed.

1. **Seeded demo data — the default.** `PULSE_SEED_DEMO=true` with no Octolens
   key. Self-contained, contains no real person's posts, and resets cleanly by
   deleting the database. The seed is deliberately representative enough to
   exercise the conversation map, themes, feedback and competitor topics — see
   `apps/cms/src/seed-demo.ts`.
2. **A sanitised snapshot** — only if you need volume. `npm run db:export`
   against production, `npm run db:import` against staging. It carries real
   people's posts, handles, and any researched emails on lead profiles, which is
   a different processing purpose from the one those were collected under.
   Delete the `components_shared_lead_profiles` rows before importing.
3. **A second Octolens key** — no. Two environments ingesting the same feed
   duplicates work and alerts, and neither one is then a clean record.

## Promoting

```
git checkout staging && git merge --ff-only master && git push
# watch the Strapi Cloud boot log, then:
git checkout master && git push        # production
```

Watch the staging boot log for the passes that only speak when they do work:

```
pulse: social accounts split out (N created, …)
pulse: seeded N team handle(s)
pulse: reclaimed N of our own post(s)
pulse: person dedupe done (N split identit(ies) merged)
```

Silence from those is normal on a second boot — they are idempotent and log only
when something changed. Silence on the **first** boot of a fresh environment is
not, and means a migration did not run.
