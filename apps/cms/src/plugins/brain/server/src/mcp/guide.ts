import fs from 'node:fs';
import path from 'node:path';

/**
 * What brain-guide returns: how to use the brain's tools and read its numbers,
 * for an agent that has never seen it. Kept here as a string so it ships in
 * the build. Update it with every tool or data change; it is what agents
 * follow.
 */
export const BRAIN_GUIDE = `# The marketing brain (in Pulse)

The brain stores Strapi's marketing numbers and the reports written from them, so each report can
compare with the last one and check what happened to what was decided. Phase 1 is YouTube: our
channel and six competitors', snapshotted once a day.

## Start here
1. Call **brain-guide** once a session (this text, plus which build production runs).
2. Before writing a report, call **brain-health**. If its status isn't "ok", say so in the report:
   name stale channels and missing days instead of comparing across them.
3. Read the open decisions (**brain-decisions**) before writing the next report, and say what
   happened to each.

## Tools
| Tool | Use it for |
|---|---|
| brain-guide | This guide and the build version |
| brain-health | Is the data fresh? Sync switch, last run, each channel's newest snapshot and missing days, overdue decisions, latest report |
| brain-youtube-channels | Every tracked channel: latest numbers and the change over N days (default 30). Start here for YouTube questions |
| brain-youtube-videos | One channel's videos with views and views per day; filter by date, Shorts, topic |
| brain-video-results | One video's views at about 7, 30 and 90 days, against its topic's median |
| brain-decisions | Decisions recorded with reports; open ones by default, soonest due first |
| brain-save-report | Save a report (Markdown summary, its data, proposed decisions) |
| brain-update-decision | Close a decision (done or dropped) with its outcome, or change its status |

## How to read the numbers
- **One snapshot a day per channel and per video**, taken at 05:00 UTC by default. "Today" is the
  UTC day.
- **Missing is not zero.** A number is null when the brain has no snapshot for that day: before
  tracking began (historyStartsOn), on a day the sync didn't run, or a milestone not reached yet.
  Say "no data", never "0".
- **History starts when tracking started** (the first snapshot, 2026-11-09 for the first seven
  channels). Until a window's start falls after that day, a change over N days has baseline null.
- **Shorts** are videos of 180 seconds or less. Live streams and premieres with no duration yet are
  not Shorts.
- **Subscribers** are null when a channel hides them, and YouTube rounds them (21,600, not 21,612).
- **Milestones** (7, 30, 90 days) use the nearest snapshot within a few days of the day; outside
  that, the value is null with the reason.
- **Topics** are set by people in the admin, so most videos have none until someone tags them.

## Writing
- **One report per kind and date.** A second save is refused (and the existing report returned)
  unless overwrite is true. Overwrite replaces the summary and data, and never removes decisions.
- **Decisions** start open, each with a person as owner. Close one only on evidence or a person's
  word, and put that evidence in the outcome.
- Every write records which client made it (via). Nothing is posted or sent anywhere.

## Permissions
Each tool is its own checkbox on an admin token: Plugins tab → brain → "MCP tools". A reporting
client needs the read tools; only a client that saves reports needs brain-save-report and
brain-update-decision.
`;

export type BuildInfo = { version: string | null; commit: string | null; builtAt: string | null };

/**
 * The stamp the plugin's build writes next to the compiled code
 * (dist/server/build-info.json; this file compiles to dist/server/mcp/).
 */
export const buildInfo = (): BuildInfo => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf8'));
    return { version: raw.version ?? null, commit: raw.commit ?? null, builtAt: raw.builtAt ?? null };
  } catch {
    return { version: null, commit: null, builtAt: null };
  }
};

/** When this process started: changes on every deploy and restart, stamp or not. */
export const BOOTED_AT = new Date().toISOString();
