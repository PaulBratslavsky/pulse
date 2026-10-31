import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';

import type { PulseTool } from './registry';

/**
 * Marketing-brain tools (phase 1: YouTube). Part of the ONE registry — spread
 * into PULSE_TOOLS, so the MCP server and the in-app assistant both get them
 * and each has its own permission action (`api::pulse-mcp.brain-…`, Settings
 * → "Pulse MCP tools"), exactly like the pulse-* tools.
 *
 * The data and the arithmetic live in the brain plugin
 * (src/plugins/brain: services stats + reports); these are the thin tool
 * shapes over it. The YouTube API key never appears in any result.
 *
 * Write tools follow the pulse-* rules: conditional (brain-save-report refuses
 * a second report for the same kind and date unless overwrite is true),
 * partial (brain-update-decision changes only what it is sent), stamped with
 * `via`, and internal — nothing is posted anywhere.
 */

const brain = (strapi: Core.Strapi, name: 'stats' | 'reports') => strapi.plugin('brain').service(name) as any;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'YYYY-MM-DD');

export const BRAIN_TOOLS: PulseTool[] = [
  {
    name: 'brain-youtube-channels',
    title: 'Brain: YouTube channels',
    description:
      'Every active tracked YouTube channel (ours and competitors) with its latest daily snapshot and ' +
      'the change over the last N days: subscribers, total views, long videos and Shorts published in ' +
      'the window, and the median views of its last 10 long videos. A channel whose history is younger ' +
      'than the window has baseline null and historyStartsOn set — say so rather than reporting a delta. ' +
      'Subscribers are null when a channel hides them. Start here for any YouTube question.',
    access: 'read',
    subject: 'plugin::brain.channel',
    input: () =>
      z.object({
        days: z.number().int().min(1).max(365).optional().describe('Window in days (default 30)'),
      }),
    execute: (strapi, args) => brain(strapi, 'stats').channels({ days: args.days ?? 30 }),
  },

  {
    name: 'brain-youtube-videos',
    title: 'Brain: YouTube videos for a channel',
    description:
      "One channel's videos, newest first, each with its latest stored views and average views per day " +
      'since publish. Shorts are 180 s or less. Topic is set by people in the admin, so most videos have ' +
      'none until someone tags them.',
    access: 'read',
    subject: 'plugin::brain.video',
    input: () =>
      z.object({
        channel: z.string().min(1).describe('Handle ("@Strapi") or YouTube channel id ("UC…")'),
        since: isoDate.optional().describe('Only videos published on or after this date (YYYY-MM-DD)'),
        shorts: z.enum(['yes', 'no']).optional().describe("'yes' = Shorts only, 'no' = long videos only (default both)"),
        topic: z.string().optional().describe('Exact topic, case-insensitive'),
        limit: z.number().int().min(1).max(200).optional().describe('Max videos (default 50)'),
      }),
    execute: (strapi, args) => brain(strapi, 'stats').videos(args),
  },

  {
    name: 'brain-video-results',
    title: 'Brain: one video at 7, 30 and 90 days',
    description:
      "A video's views at ~7, ~30 and ~90 days after publish, read from the daily snapshots. A value is " +
      "null with missing='not-reached' when that day has not come yet, or missing='no-snapshot' when the " +
      'sync was not tracking the video then (videos older than the brain have no early numbers). If the ' +
      "video has a topic, topicMedian gives the same milestones' median across its channel's other videos " +
      'with that topic and format, for comparison.',
    access: 'read',
    subject: 'plugin::brain.video',
    input: () => z.object({ video: z.string().min(1).describe('YouTube video id (the 11 characters after v=)') }),
    execute: (strapi, args) => brain(strapi, 'stats').videoResults(args),
  },

  {
    name: 'brain-save-report',
    title: 'Brain: save a report',
    description:
      'Save a report (e.g. the monthly YouTube review): a Markdown summary written for people, the data ' +
      'it was written from, and optionally the decisions it proposes, each saved as an open decision ' +
      'for a person to own. One report per kind and date: a second save is refused (and the existing ' +
      'one returned) unless overwrite=true, which replaces summary and data but never removes ' +
      'decisions. Internal only — nothing is sent or published.',
    access: 'write',
    subject: 'plugin::brain.report',
    input: () =>
      z.object({
        summary: z.string().min(1).max(50_000).describe('The report, in Markdown'),
        data: z.record(z.string(), z.any()).optional().describe('The numbers behind it, as an object'),
        kind: z.enum(['youtube-monthly']).optional().describe("Default 'youtube-monthly'"),
        date: isoDate.optional().describe('Report date, YYYY-MM-DD (default today, UTC)'),
        decisions: z
          .array(
            z.object({
              text: z.string().min(3).max(1000).describe('What we will do'),
              owner: z.string().max(100).optional().describe('Who owns it'),
              due: isoDate.optional().describe('YYYY-MM-DD'),
            })
          )
          .max(20)
          .optional(),
        overwrite: z.boolean().optional().describe('Required true to replace an existing report for the same kind and date'),
      }),
    execute: (strapi, args, meta) => brain(strapi, 'reports').save(args, meta.via),
  },

  {
    name: 'brain-decisions',
    title: 'Brain: decisions',
    description:
      'Decisions recorded with reports, soonest due first, each with the report it came from. Default ' +
      'is the open ones — read these before writing the next report, and say what happened to each.',
    access: 'read',
    subject: 'plugin::brain.decision',
    input: () =>
      z.object({
        status: z.enum(['open', 'done', 'dropped', 'any']).optional().describe("Default 'open'"),
        owner: z.string().optional().describe('Owner contains this text'),
        limit: z.number().int().min(1).max(200).optional().describe('Max decisions (default 50)'),
      }),
    execute: (strapi, args) => brain(strapi, 'reports').decisions(args),
  },

  {
    name: 'brain-update-decision',
    title: 'Brain: update a decision (partial)',
    description:
      "PARTIAL update of one decision — send only what changes: status (open, done, dropped) and/or " +
      'outcome (what actually happened, in a sentence or two). Close a decision only on evidence or on ' +
      "a person's word, and put that evidence in the outcome.",
    access: 'write',
    subject: 'plugin::brain.decision',
    input: () =>
      z.object({
        documentId: z.string().describe('Decision documentId, from brain-decisions'),
        status: z.enum(['open', 'done', 'dropped']).optional(),
        outcome: z.string().max(4000).optional(),
      }),
    execute: (strapi, args, meta) => brain(strapi, 'reports').updateDecision(args, meta.via),
  },
];
