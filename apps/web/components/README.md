# Components

Grouped by **what they are about**, which is nearly always the route that renders
them. Flat, this directory was 38 files where `lead-scoring` (a Settings panel)
sorted next to `lead-status` (a Leads control) and neither told you where it was
used.

| folder | about | rendered by |
| --- | --- | --- |
| `ui/` | primitives used everywhere — buttons, badges, chips, empty states, the error line, the theme toggle, search | all routes |
| `navigation/` | the shell: top nav, sidebars, mobile drawer | `layout.tsx` |
| `queue/` | working the list: bulk triage, claim, sync, remembering the filtered view | `/` |
| `mention/` | one mention: its controls, moderation, topics, the conversation it belongs to, the responses on it | `/mentions/[id]`, some on `/` |
| `reply/` | writing the reply: the box, the docs-grounded draft, the assistant, and the shared draft state all three edit | `/mentions/[id]` |
| `timeline/` | the activity + notes timeline, shared by mentions and people | `/mentions/[id]`, `/leads/[documentId]` |
| `leads/` | people and leads: cards, profile, status, merge, search | `/leads`, `/leads/[documentId]`, `/people` |
| `insights/` | reporting: trends, graph, themes, feedback, events | `/trends`, `/graph`, `/themes`, `/feedback` |
| `settings/` | admin panels: MCP servers, muted authors, classification, lead scoring, leaderboard opt-out | `/settings` |
| `chat/` | the standalone assistant page | `/chat` |

Two conventions worth keeping:

- **`ui/index.tsx`** holds the primitives, so `@/components/ui` resolves without
  a path change. Everything else is imported by its full path.
- A component used by two routes lives with the **thing** it is about, not with
  the first route that happened to need it. `mention/spam-flag-button` is
  rendered by both the queue and the detail page; it is about a mention.
