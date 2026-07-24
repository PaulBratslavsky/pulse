# Pulse

The Strapi team's internal tool for tracking sentiment across social mentions, capturing the full response trail, and turning recurring signals into product decisions.

- **Spec**: [`06-build-spec.md`](06-build-spec.md) (stages 1–5 in the sibling `0*.md` files)
- **Backend**: Strapi v5 (≥ 5.49) — `apps/cms` (local plugins in `apps/cms/src/plugins/`)
- **Frontend**: Next.js 16 (App Router) — `apps/web`

## Local dev

```bash
npm install
npm run dev:cms   # Strapi on :1337 (SQLite locally; Postgres on Strapi Cloud)
npm run dev:web   # Next.js on :3000
```

Copy `apps/cms/.env.example` → `apps/cms/.env` and `apps/web/.env.example` → `apps/web/.env.local`, then fill in secrets (see the Environment variables section of the build spec).
