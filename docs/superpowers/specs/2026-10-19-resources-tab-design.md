# Resources tab — design

**Date:** 2026-10-19
**Status:** approved. Phases 1 (backend), 2 (Resources tab) and 3 (related resources on a mention) are implemented; phases 4–5 are not.

## The problem

A good reply often ends with "we wrote about exactly this" and a link. Today
nobody in Pulse can find that link without leaving the app, searching
strapi.io/blog by hand and hoping the title matches what the person asked.

The drafter does not help either. It is grounded in the docs (the docs MCP plus
the `docs.strapi.io` sitemap allow-list in `utils/docs-links.ts`), but it knows
nothing about the blog. Worse, `stripDeadDocsLinks` only checks
`docs.strapi.io` URLs, so if the model makes up a `strapi.io/blog/...` link, it
goes out to the public untouched.

## The goal

1. The team can **search the marketing site's blog from inside Pulse**.
2. The team **saves the posts worth sending people to** as Pulse's own
   resources. This is a curated subset, not the whole blog.
3. On a mention, Pulse **suggests saved resources** and inserts one into the
   reply with a click.
4. The drafter **may suggest** a saved resource, but **never puts a link in the
   draft itself**. Linking stays a human decision.

## Decisions (2026-10-19)

| Question | Decision |
| --- | --- |
| Mirror the whole blog, or keep a subset? | **Keep a subset.** Search the source live and save chosen posts as Pulse records. Only saved posts are stored and refreshed. |
| How Pulse reaches the marketing site | The marketing Strapi's **built-in MCP**, with an admin token **scoped to the list/get blog tools only**. |
| Scope of v1 | **Blog posts only** (`kind: 'blog'`). |
| Drafter | **Suggest only, no auto-link.** |

### Why a subset

- **Quality.** The team decides what is worth sending. A suggestion list made
  from the whole blog would surface SEO pieces and stale posts as readily as
  the good ones.
- **Cost.** The source cannot select fields, or filter or sort by `updatedAt`,
  and every list result carries the full article body. Mirroring would mean
  re-reading the entire blog on every sync. Live search returns 10 posts at a
  time, and the refresh job only re-reads the posts that were saved.
- **Ownership.** A saved resource is Pulse's own copy. It survives the post
  being renamed or unpublished, and it can carry the team's note ("good for
  webhook-signature questions"), a pin, and later which replies used it.

## The source: marketing MCP

Tools Pulse uses (checked against the live server on 2026-10-19):

| Tool | Used for |
| --- | --- |
| `list_blog-post` | live search. `filters.$or` with `$containsi` on `title`, `description` and `content`, sorted by `originalPublishedAt:desc`. `updatedAt` is **not** filterable or sortable. |
| `get_blog-post` | save and refresh, by `documentId`. A missing post returns the error text "Document not found." |
| `list_blog-category` | category names. Posts only carry the documentId. Cached for 6 h. |
| `list_blog-tag` | tag names (103 today). Cached for 6 h. |

**Read-only is enforced, not assumed.** Every connection lists the token's
tools first. If any `create_` / `update_` / `delete_` / `publish_` /
`unpublish_` / `discard_` tool is visible, Pulse refuses with a clear error
(the endpoint returns 502 "Grant it only the list/get blog tools"). The
token to create in the marketing admin is an admin token granted only:
`list_blog-post`, `get_blog-post`, `list_blog-category`, `list_blog-tag`.

## Data model: `api::resource.resource` (implemented)

| Field | Type | Owner | Notes |
| --- | --- | --- | --- |
| `kind` | enum `blog` | source | extend later for docs or hand-added links |
| `title`, `url` (unique), `summary` | string/text | source | `url` = blog canonical URL, else `MARKETING_BLOG_BASE_URL/{slug}`. `summary` = description, then meta description, then first paragraph. |
| `keywords` | json | source | SEO keywords + tag names + category |
| `category` | string | source | |
| `postedAt` | datetime | source | `originalPublishedAt` |
| `sourceId` (unique), `sourceUpdatedAt` | | source | marketing `documentId`; change detection for refresh |
| `searchText` | text, **private** | source | lowercased title + summary + keywords + the first 2 KB of body, for matching in phase 3. Never sent to the browser. |
| `note` | text | team | why this post is useful |
| `pinned`, `hidden` | boolean | team | |
| `savedBy` | → user | team | |
| `upstreamMissing` | boolean | refresh | the post was unpublished or deleted upstream; flagged, **never deleted** |
| `refreshedAt` | datetime | refresh | |

Fields owned by the source are rewritten by refresh. Fields owned by the team
never are.

## API (implemented; all on the Authenticated role via `AUTHENTICATED_ACTIONS`)

| Method | Path | What |
| --- | --- | --- |
| GET | `/resources/source/search?q=&page=` | Live search of the marketing blog (q ≥ 2 characters). Title matches come first, 10 per page. Each result carries `savedId` (or null), so the UI can show "Saved". `searchText` is stripped. |
| POST | `/resources` `{ sourceId, note? }` | Save a post. The post is **re-read from the source** rather than trusting the browser. Saving twice returns the same row; saving a hidden one un-hides it. Returns 404 if the post isn't published. |
| GET | `/resources?q=&includeHidden=` | The saved list, pinned first then newest. `q` also matches `searchText`, so body text finds a post. |
| PUT | `/resources/:documentId` | Updates only the team's fields: `pinned`, `hidden`, `note`. |
| DELETE | `/resources/:documentId` | Remove a saved resource. |
| POST | `/resources/refresh` | Re-read all saved posts in the background. Returns 202. |

Marketing-site failures come back as **502** with the source's message, or as
**503** when the integration isn't configured. Neither is a bare 500.

**Cron:** `resourceRefresh` runs daily at 04:00 (`RESOURCE_REFRESH_CRON`). It
re-reads only the saved posts. A post that fails to load is left as it was; a
network blip never reads as "unpublished".

**Env:** `MARKETING_MCP_URL`, `MARKETING_MCP_TOKEN`, `MARKETING_BLOG_BASE_URL`
(default `https://strapi.io/blog`) and `RESOURCE_REFRESH_CRON`. Without the
URL and token, the source endpoints return 503 and refresh is a no-op.

**Code:**
- `apps/cms/src/api/resource/services/source.ts` is the only code that talks to
  the marketing site. Swapping in a REST Content API token later is a change
  to this file only.
- `services/resource.ts` holds save, list, patch and refresh.
- `controllers/resource.ts` and `routes/resource.ts` expose the endpoints.

## Remaining phases

2. **Resources tab** (`app/resources/page.tsx`, plus a nav entry in
   `components/navigation/nav-links.tsx`):
   - Two panes: **Saved** (search, pin, hide, note, copy link, an
     "unpublished upstream" badge) and **Find on the blog** (live search with
     Save buttons and a "Saved ✓" state).
   - Reads go through `lib/loaders.ts`; mutations go through `pulseFetch`.
3. **Related resources on a mention** *(implemented)*:
   `GET /mentions/:documentId/resources` (`services/match.ts`) ranks **saved**
   resources against the mention by keyword score, with no model call:
   - title ×3, keywords ×2, `searchText` ×1 per distinct mention term;
     +3 when a whole multi-word keyword appears in the mention; +1 for pinned
     once something matched. Rows scoring below 3 are dropped.
   - Mention terms come from content, `matchedKeywords` and topic names, with
     stopwords (including "strapi", "cms", "headless") removed and a light
     plural fold ("apis" → "api").
   - Hidden and unpublished-upstream resources are never suggested.
   - `rankResources()` is pure, so phase 4 can reuse it.
   - The panel (`components/reply/related-resources.tsx`) sits in the reply
     side column. It is shown even when AI is off. It lists the top 5 with
     the team note (or summary) and the matched terms, and has a search box
     over saved resources for when the suggestion misses.
   - **Insert** puts `title — url` at the reply cursor through
     `reply-draft-context.tsx` (`insert()`, `via: 'resource'`). It is
     undoable with the existing undo.
4. **Drafter suggests, never links**:
   - `draft()` returns `suggestedResources` (the top 3 saved matches) next to
     `sourceUrls`. The prompt does **not** get blog URLs.
   - `stripDeadDocsLinks` is extended to also strip any `strapi.io/blog/` URL
     the model writes. This closes the hole above, because a blog link can
     then only enter a reply by a person clicking Insert.
5. **Tracking**:
   - `response.resources` (manyToMany), filled on submit from the URLs in
     `finalText`.
   - A "used in N replies" column.
   - A list of "questions with no saved resource", as content-gap input for
     marketing.
   - A `pulse-find-resources` MCP tool.

## Tests

- **Phase 1** was verified against a stub MCP server that mimics the marketing
  tools:
  - search, save, the 404 for an unpublished post, saving twice, pin, and list
    (including a body-text match);
  - refresh flagging an unpublished post while keeping its pin and note;
  - the write-tool refusal, and a 403 when unauthenticated.
- Phases 2+ add Playwright specs, following the repo pattern (there is no unit
  runner):
  - `resource-match.spec.ts` for scoring;
  - `link-audit.spec.ts` for blog-link stripping;
  - `resources.spec.ts` (e2e) for save, then insert into the reply.
- E2E must use seeded `resource` rows, never the real marketing site.
