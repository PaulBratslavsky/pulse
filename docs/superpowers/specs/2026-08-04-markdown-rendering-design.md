# Markdown rendering — design

**Date:** 2026-08-04
**Status:** approved, not yet implemented

## The problem

The model writes markdown. Pulse renders it as characters.

A draft arrives reading `✅ **Structured, reusable content** — Strapi's Content-Type
Builder lets you...` and the panel shows the asterisks. The assistant's answers are
worse: a reply about the MCP server came back as twenty lines of `- **It's built-in**
(opt-in, disabled by default)`, which is a bulleted list wearing punctuation. Nine
places in the app render text with `whitespace-pre-wrap`, and the ones showing
model output all have this problem.

It is not only ugly. A draft you cannot read at a glance is a draft you skim, and
skimming is how an unverified technical claim reaches a public reply.

## The rule

Render markdown for text **we** produced. Leave text **they** produced literal.

A mention is evidence of what someone posted. LinkedIn has no markdown, so a
LinkedIn post containing `**AI-ready**` displays those asterisks to the world.
Formatting it inside Pulse would show something that never existed. The same
applies to a recorded response: that field is what you actually posted, and
prettifying it is a quiet lie about what happened.

## Scope

**Gets markdown** (ours, or team-written):

| file | content |
| --- | --- |
| `components/reply/draft-panel.tsx` | the generated draft |
| `components/reply/reply-chat.tsx` | assistant messages, and the proposed reply |
| `components/chat/chat-ui.tsx` | assistant messages |
| `components/timeline/discussion-card.tsx` | notes and comments the team writes |
| `components/insights/feedback-list.tsx` | feedback body |

**Stays literal**, each for a stated reason:

| file | why |
| --- | --- |
| `app/mentions/[id]/page.tsx:131` — mention body | evidence of what was posted |
| `app/mentions/[id]/page.tsx:207` — recorded response | what you actually posted |
| `reply-chat.tsx` / `chat-ui.tsx` — user turns | you typed them |
| the reply textarea | you paste its literal characters into X, LinkedIn or Reddit; X and LinkedIn have no markdown, so a WYSIWYG would show formatting the platform will not |
| `components/settings/mcp-servers.tsx` | a test-query echo, not prose |
| `components/timeline/system-entry.tsx` | system strings, not prose |

## Component

`components/ui/markdown.tsx` — one wrapper over `react-markdown@10` +
`remark-gfm@4`. Verified against this stack: peer range is `react >=18`, and the
app is React 19.2 / Next 16.2.

Constrained on purpose:

- **No raw HTML.** react-markdown's default, and we do not add `rehype-raw`.
  Model output is not trusted input.
- **No images.** A draft has no business embedding one, and a broken or remote
  image in a 380px panel is noise.
- **Links open in a new tab** with `rel="noopener noreferrer"` — the docs links
  in a draft are meant to be checked, not to navigate you away from the reply
  you are writing.
- **Headings downgraded** to `text-sm font-medium`. A model emitting `#` inside
  a 380px sidebar would otherwise blow out the column.
- **Tables and code blocks scroll** inside `overflow-x-auto`. The page must never
  scroll horizontally because a model emitted a wide table.

Styling is explicit Tailwind on each element. No `@tailwindcss/typography` — the
plugin is not installed, and adding one for five surfaces is a dependency we do
not need.

## Not doing

**`@mdxeditor/editor`.** It was the original request, and it was dropped
deliberately once the draft panel was settled as display-only: a WYSIWYG editing
component is the wrong tool for text nobody edits in place, and it is a heavy
client-only bundle on the busiest page in the app. If in-place draft editing is
wanted later, this is the decision to revisit.

## Error handling

None at runtime. Malformed markdown renders as text rather than throwing — that
is react-markdown's behaviour and it is the behaviour we want: a mangled draft
should still be readable and fixable, not an error boundary.

## Testing

Deterministic, with no model call — both halves of the rule, in one e2e test:

1. Post a timeline note containing `**bold**`; assert a `<strong>` renders.
2. Inject a mention whose body contains `**bold**`; assert the literal asterisks
   are still on screen.

The second assertion is the one worth having. It is easy to "fix markdown
everywhere" in a later change and silently start reformatting other people's
posts; this test fails when that happens.

Plus the existing suite (70 passing) for regressions, and `next build` — a new
dependency that breaks the production build is the failure mode a dev server
hides.
