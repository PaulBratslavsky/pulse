# Users & Usage

## Personas

### Dana — DevRel
- Background: lives on social channels; first to spot spicy mentions; answers technical questions in public.
- Current workaround: responds to whatever she happens to see, from her own accounts; no record of what was said or whether it helped.
- Tech comfort: high.

### Mark — Marketing
- Background: cares about launch reception and the overall sentiment narrative; wants to know how announcements land.
- Current workaround: asks for a sentiment report after each launch, or skims channels manually.
- Tech comfort: medium — wants dashboards, not queries.

### Priya — Product
- Background: prioritizes what gets built; today receives community pain as Slack anecdotes ("people keep complaining about X").
- Current workaround: gut feel + whatever evidence someone pastes into a thread.
- Tech comfort: medium-high.

### Paul — Admin (runs Pulse itself)
- Background: currently the person who runs the manual reports; sets up the data feed, accounts, and categories.
- Current workaround: is the workaround.
- Tech comfort: very high.

> Each teammate has **their own account**. Roles start simple (everyone sees everything) but the model must be **extensible** — new roles/permissions as use cases emerge, without redesign.

## Jobs-to-be-done
- When a new mention comes in, **Dana** wants to see it in a shared queue, claim it, and reply where it happened, so nothing falls through and her response is on the record.
- When a launch or release goes out, **Mark** wants to watch sentiment move in the days after, so he can tie reception to the event rather than guess.
- When planning the roadmap, **Priya** wants recurring pain points as evidenced clusters (not anecdotes), so she can justify what gets built.
- When a tricky mention appears, **Dana** wants to see past responses on the same topic and how they landed, so she reuses what works.
- When onboarding a teammate or a new use case appears, **Paul** wants to add an account/adjust access in minutes, so the tool grows with the team.

## Primary user journey
1. Discovery: a teammate is invited by Paul and gets an account.
2. First use: they log in and land on the **unanswered mentions** queue — real mentions, sentiment attached, some already claimed by others.
3. Aha moment: they claim a mention, reply where it happened, log the response — and later see the mention marked answered and the **sentiment score tick up**. Their work visibly moved the number.
4. Ongoing use: the queue and the trend dashboard become the daily starting point; product checks the recurring-themes feed each planning cycle.

## Core loop
- The repeated action: **log in → see unanswered mentions → claim (or route) one → reply where it happened → track progress until it's resolved.** Triage is shared: mentions arrive unassigned; anyone can claim, or flag to the right owner (DevRel / Marketing / Product).
- What pulls users back: answered-count climbing and the **sentiment score improving** — visible proof the work is landing, plus the fear of an unanswered spicy mention sitting in the queue.
