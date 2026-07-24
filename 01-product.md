# Pulse

## One-liner
Pulse is the Strapi team's shared tool for tracking sentiment across social mentions, capturing the full response trail, and turning recurring signals into product decisions.

## The problem
Strapi gets mentioned constantly across social channels — praise, bug complaints, docs confusion, competitor comparisons. Today that signal is scattered: whoever happens to see a mention responds (or doesn't), the outcome of a response is never captured, and sentiment insight lives in one-off reports a single person runs plus anecdotes in Slack. The team can't see trends (did sentiment dip after that release?), can't learn from which responses actually land, and recurring pain points reach the product team as vibes rather than evidence.

## The value
- **One place, whole team.** Every mention lands in a shared tool with sentiment attached — anyone on DevRel, support, or product can self-serve instead of waiting for a report.
- **Trends, not snapshots.** Sentiment tracked over time, so shifts can be tied to releases, launches, or incidents — and the team can watch the sentiment score improve as responses and fixes land.
- **A response library that compounds.** Who responded, what was said, and how it landed is captured — over time this becomes a playbook of what works.
- **Signal → roadmap.** Recurring pain points surface as structured, evidenced clusters the product team can act on — mention data helps dictate what gets built to improve Strapi itself.

## Product category
Internal tool — single instance, for the Strapi team only. Explicitly **not** a multi-tenant product for other companies (pinned; this constraint shapes the entire data model).

## What success looks like
A year in: a product manager opens Pulse, sees a cluster of mentions about a confusing migration step that's been growing for three weeks, and puts a fix on the roadmap with the mention evidence attached. After the fix ships, the same dashboard shows sentiment on that topic recovering. Meanwhile, a new DevRel hire answers a tricky mention on day one by pulling up the responses that worked the last four times this topic came up. Nobody runs a manual report anymore — the sentiment score, and its steady improvement, is something the whole team just *sees*.
