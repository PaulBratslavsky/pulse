import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';
import { logActivity } from '../utils/activity';

/**
 * ONE tool registry, TWO surfaces (user decision, 2026-07-27): the same tools are
 * exposed externally on the built-in MCP server (Claude Desktop / Claude Code with
 * an admin token) and internally to the in-app assistant's Claude API tool-use loop.
 * Define a tool once here; both surfaces pick it up automatically.
 *
 * zod v4 (via @strapi/utils) serves both: the MCP server takes the zod schema
 * directly, the Anthropic Messages API gets z.toJSONSchema() of the same object.
 */

export type PulseTool = {
  name: string;
  title: string;
  description: string;
  access: 'read' | 'write';
  /** content-type uid the MCP auth policy gates on */
  subject: string;
  input: () => any;
  execute: (strapi: Core.Strapi, args: any, meta: { via: string }) => Promise<unknown>;
};

/**
 * Every tool is gated by its OWN admin permission action — registered in
 * bootstrap so each tool shows up as a checkbox on the Admin Token screen
 * (Settings tab → "Pulse MCP tools"). Checking/unchecking a box there is the
 * single source of truth for whether a token may call that tool.
 * App-level registration (no pluginName) → actionId `api::<uid>`.
 */
export const toolActionUid = (tool: PulseTool) => `pulse-mcp.${tool.name.replace(/^pulse-/, '')}`;
export const toolAction = (tool: PulseTool) => `api::${toolActionUid(tool)}`;

const trimUser = (u: any) => (u ? { username: u.username } : null);

export const PULSE_TOOLS: PulseTool[] = [
  {
    name: 'pulse-queue',
    title: 'Pulse: response queue',
    description:
      'List mentions awaiting a reply, oldest first. Start here when drafting: pick a documentId, ' +
      'then call pulse-get-mention for full context. Items that already carry a draft include draftText.',
    access: 'read',
    subject: 'api::mention.mention',
    input: () =>
      z.object({
        status: z
          .enum(['unanswered', 'claimed', 'answered', 'acknowledged', 'resolved'])
          .optional()
          .describe('Workflow status filter (default: unanswered + claimed)'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      }),
    execute: (strapi, args) =>
      strapi.documents('api::mention.mention').findMany({
        filters: args.status ? { status: args.status } : { status: { $in: ['unanswered', 'claimed'] } },
        fields: ['content', 'sentimentLabel', 'status', 'postedAt', 'url', 'draftText'],
        populate: { topics: { fields: ['name', 'slug', 'kind'] }, channel: { fields: ['name'] } } as any,
        sort: 'receivedAt:asc' as any,
        limit: args.limit ?? 20,
      }),
  },

  {
    name: 'pulse-get-mention',
    title: 'Pulse: mention detail',
    description:
      'Full context for one mention: content, sentiment, topics, workflow status, prior responses ' +
      '(a Response = a reply that was actually posted; pending drafts live on mention.draftText), ' +
      'team discussion (notes/comments/feedback), the activity trail, and up to 5 past public ' +
      'replies on the same topics — use those to match the team voice before drafting.',
    access: 'read',
    subject: 'api::mention.mention',
    input: () => z.object({ documentId: z.string().describe('Mention documentId') }),
    execute: async (strapi, args) => {
      const m: any = await strapi.documents('api::mention.mention').findOne({
        documentId: args.documentId,
        populate: {
          topics: { fields: ['name', 'slug', 'kind'] },
          channel: { fields: ['name'] },
          responses: {
            fields: ['finalText', 'notes', 'internal', 'respondedAt'],
            populate: { respondedBy: { fields: ['username'] } },
          },
          activities: { fields: ['action', 'detail', 'at'], sort: 'at:asc' },
          comments: {
            fields: ['kind', 'body', 'links', 'createdAt'],
            filters: { archived: { $ne: true } },
            populate: { author: { fields: ['username'] } },
            sort: 'createdAt:asc',
          },
        } as any,
      });
      if (!m) return { error: `mention ${args.documentId} not found` };

      const topicIds = (m.topics ?? []).map((t: any) => t.documentId);
      const similar = topicIds.length
        ? await strapi.documents('api::response.response').findMany({
            filters: {
              internal: { $ne: true },
              mention: { documentId: { $ne: args.documentId }, topics: { documentId: { $in: topicIds } } },
            } as any,
            fields: ['finalText', 'respondedAt'],
            sort: 'respondedAt:desc' as any,
            limit: 5,
          })
        : [];

      return {
        mention: {
          documentId: m.documentId,
          content: m.content,
          authorHandle: m.authorHandle,
          url: m.url,
          postedAt: m.postedAt,
          channel: m.channel?.name ?? null,
          sentimentLabel: m.sentimentLabel,
          status: m.status,
          acknowledgeReason: m.acknowledgeReason ?? null,
          topics: (m.topics ?? []).map((t: any) => ({ name: t.name, kind: t.kind })),
          draftText: m.draftText ?? null,
          responses: (m.responses ?? []).map((r: any) => ({
            finalText: r.finalText,
            notes: r.notes,
            internal: Boolean(r.internal),
            respondedAt: r.respondedAt,
            respondedBy: trimUser(r.respondedBy)?.username ?? null,
          })),
          activity: (m.activities ?? []).map((a: any) => ({ action: a.action, detail: a.detail, at: a.at })),
          discussion: (m.comments ?? []).map((c: any) => ({
            kind: c.kind,
            body: c.body,
            links: c.links ?? [],
            author: trimUser(c.author)?.username ?? null,
            at: c.createdAt,
          })),
        },
        similarPastReplies: similar.map((r: any) => ({ finalText: r.finalText, respondedAt: r.respondedAt })),
      };
    },
  },

  {
    name: 'pulse-save-draft',
    title: 'Pulse: save draft reply',
    description:
      'Save a draft reply on a mention. Drafts live ONLY on the mention (mention.draftText) — a ' +
      'Response record is created later by a human, only for a reply that was actually posted. ' +
      'The draft pre-fills the reply form in Pulse for a human to review, post on the platform, ' +
      'and record — this tool NEVER auto-posts anything. Writes are conditional: if a draft ' +
      'already exists the call is refused (returned in the result) unless overwrite=true, so ' +
      're-runs never silently clobber a human-edited draft. Keep drafts in the team voice: ' +
      'helpful, concrete, no marketing tone; for competitor threads prefer an internal note.',
    access: 'write',
    subject: 'api::mention.mention',
    input: () =>
      z.object({
        documentId: z.string().describe('Mention documentId'),
        draft: z.string().min(1).max(4000).describe('The proposed reply text'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Required true to replace an existing draft; default refuses and returns it'),
      }),
    execute: async (strapi, args, meta) => {
      const mention: any = await strapi.documents('api::mention.mention').findOne({ documentId: args.documentId });
      if (!mention) return { error: `mention ${args.documentId} not found` };
      if (mention.draftText && !args.overwrite) {
        return {
          saved: false,
          reason: 'draft already exists — pass overwrite: true to replace it',
          existingDraft: mention.draftText,
          draftedVia: mention.draftedVia ?? null,
          draftedAt: mention.draftedAt ?? null,
        };
      }
      await strapi.documents('api::mention.mention').update({
        documentId: args.documentId,
        data: { draftText: args.draft, draftedAt: new Date().toISOString(), draftedVia: meta.via } as any,
      });
      await logActivity(strapi, {
        mentionDocumentId: args.documentId,
        action: 'drafted',
        detail: { via: meta.via, chars: args.draft.length },
      });
      return { saved: true, documentId: args.documentId, via: meta.via };
    },
  },

  {
    name: 'pulse-search-mentions',
    title: 'Pulse: search mentions',
    description: 'Search Pulse mentions by text. Returns matching mentions with sentiment, status, and topics.',
    access: 'read',
    subject: 'api::mention.mention',
    input: () =>
      z.object({
        query: z.string().min(2).describe('Text to search mention content for'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      }),
    execute: (strapi, args) =>
      strapi.documents('api::mention.mention').findMany({
        filters: { content: { $containsi: args.query } },
        fields: ['content', 'sentimentLabel', 'sentimentScore', 'status', 'postedAt', 'url'],
        populate: { topics: { fields: ['name'] }, channel: { fields: ['name'] } } as any,
        sort: 'postedAt:desc' as any,
        limit: args.limit ?? 20,
      }),
  },

  {
    name: 'pulse-trend-summary',
    title: 'Pulse: sentiment trend',
    description:
      'The Pulse sentiment score (0-100, trailing-7d volume-weighted, UTC days) over a date range, with annotated events.',
    access: 'read',
    subject: 'api::mention.mention',
    input: () =>
      z.object({
        from: z.string().optional().describe('ISO date, default 90 days ago'),
        to: z.string().optional().describe('ISO date, default now'),
        topic: z.string().optional().describe('Topic slug to filter by'),
      }),
    execute: (strapi, args) => (strapi.service('api::analysis.insights') as any).trends(args),
  },

  {
    name: 'pulse-theme-report',
    title: 'Pulse: recurring themes',
    description: 'Recurring themes ranked by volume × negativity over a window (days), with evidence mention ids.',
    access: 'read',
    subject: 'api::topic.topic',
    input: () =>
      z.object({
        days: z.number().int().min(1).max(365).optional().describe('Window in days (default 30)'),
      }),
    execute: (strapi, args) => (strapi.service('api::analysis.insights') as any).themes(args),
  },
];

export const getTool = (name: string) => PULSE_TOOLS.find((t) => t.name === name);

/** The same registry as an Anthropic Messages API `tools` array (in-app assistant). */
export const anthropicTools = () =>
  PULSE_TOOLS.map((t) => {
    const schema: any = z.toJSONSchema(t.input());
    delete schema.$schema; // Anthropic input_schema is bare JSON Schema
    return { name: t.name, description: t.description, input_schema: schema };
  });
