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
        draft: z
          .enum(['any', 'has-draft', 'no-draft'])
          .optional()
          .describe("Draft state — use 'no-draft' to find undrafted work (default any)"),
        sentiment: z.enum(['positive', 'neutral', 'negative', 'na']).optional(),
        topic: z.string().optional().describe('Topic slug'),
        search: z.string().optional().describe('Case-insensitive substring of the mention content'),
        excerptChars: z
          .number()
          .int()
          .min(80)
          .max(4000)
          .optional()
          .describe('Truncate content to N chars (default 400; use pulse-get-mention for the full body)'),
        page: z.number().int().min(1).optional().describe('1-based page (default 1)'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 20, max 100)'),
      }),
    execute: async (strapi, args) => {
      const limit = args.limit ?? 20;
      const page = args.page ?? 1;
      const excerpt = args.excerptChars ?? 400;
      const filters: any = {
        ...(args.status ? { status: args.status } : { status: { $in: ['unanswered', 'claimed'] } }),
        ...(args.sentiment ? { sentimentLabel: args.sentiment } : {}),
        ...(args.topic ? { topics: { slug: args.topic } } : {}),
        ...(args.search ? { content: { $containsi: args.search } } : {}),
        ...(args.draft === 'has-draft' ? { draftText: { $notNull: true } } : {}),
        ...(args.draft === 'no-draft' ? { draftText: { $null: true } } : {}),
      };
      const [rows, total] = await Promise.all([
        strapi.documents('api::mention.mention').findMany({
          filters,
          fields: ['content', 'sentimentLabel', 'status', 'postedAt', 'url', 'draftText', 'externalId'],
          populate: { topics: { fields: ['name', 'slug', 'kind'] }, channel: { fields: ['name'] } } as any,
          sort: 'postedAt:asc' as any,
          limit,
          start: (page - 1) * limit,
        }),
        strapi.documents('api::mention.mention').count({ filters }),
      ]);
      return {
        page,
        limit,
        total,
        hasMore: page * limit < total,
        mentions: (rows as any[]).map((m) => ({
          documentId: m.documentId,
          externalId: m.externalId,
          excerpt: String(m.content ?? '').slice(0, excerpt),
          truncated: String(m.content ?? '').length > excerpt,
          sentimentLabel: m.sentimentLabel,
          status: m.status,
          postedAt: m.postedAt,
          url: m.url,
          hasDraft: Boolean(m.draftText),
          channel: m.channel?.name ?? null,
          topics: (m.topics ?? []).map((t: any) => t.name),
        })),
      };
    },
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
    name: 'pulse-update-mention',
    title: 'Pulse: update mention fields (partial)',
    description:
      'PARTIAL update — send ONLY the fields you want to change. Never resend content: the ' +
      'mention body is immutable through this tool by design (a truncated resend corrupted a ' +
      'post on 2026-07-28). Editable: draftText, sentimentLabel (human correction — stamps ' +
      'humanCorrected, n/a clears the score), suggestedTeam, topics (by slug, replaces the set). ' +
      'Workflow status changes go through pulse-acknowledge / the app, not here.',
    access: 'write',
    subject: 'api::mention.mention',
    input: () =>
      z.object({
        documentId: z.string().describe('Mention documentId'),
        draftText: z.string().max(4000).optional().describe('Replace the pending draft'),
        sentimentLabel: z
          .enum(['positive', 'neutral', 'negative', 'na'])
          .optional()
          .describe("Human correction; 'na' = not about Strapi (clears the score)"),
        suggestedTeam: z.enum(['devrel', 'marketing', 'product']).optional(),
        topicSlugs: z.array(z.string()).max(20).optional().describe('Replace topics (by slug)'),
      }),
    execute: async (strapi, args, meta) => {
      const mention: any = await strapi.documents('api::mention.mention').findOne({ documentId: args.documentId });
      if (!mention) return { error: `mention ${args.documentId} not found` };

      const data: Record<string, unknown> = {};
      const changed: string[] = [];
      if (args.draftText !== undefined) {
        data.draftText = args.draftText;
        data.draftedAt = new Date().toISOString();
        data.draftedVia = meta.via;
        changed.push('draftText');
      }
      if (args.sentimentLabel !== undefined) {
        data.sentimentLabel = args.sentimentLabel;
        data.humanCorrected = true;
        if (args.sentimentLabel === 'na') data.sentimentScore = null;
        changed.push('sentimentLabel');
      }
      if (args.suggestedTeam !== undefined) {
        data.suggestedTeam = args.suggestedTeam;
        changed.push('suggestedTeam');
      }
      if (args.topicSlugs !== undefined) {
        const topics = await strapi
          .documents('api::topic.topic')
          .findMany({ filters: { slug: { $in: args.topicSlugs } } as any, fields: ['slug'] });
        const found = (topics as any[]).map((t) => t.documentId);
        const missing = args.topicSlugs.filter((sl: string) => !(topics as any[]).some((t) => t.slug === sl));
        if (missing.length) return { error: `unknown topic slug(s): ${missing.join(', ')}` };
        data.topics = found;
        changed.push('topics');
      }
      if (!changed.length) return { error: 'nothing to update — pass at least one field' };

      await strapi.documents('api::mention.mention').update({ documentId: args.documentId, data: data as any });
      if (args.sentimentLabel !== undefined) {
        await logActivity(strapi, {
          mentionDocumentId: args.documentId,
          action: 'corrected',
          detail: { via: meta.via, sentimentLabel: args.sentimentLabel },
        });
      }
      if (args.draftText !== undefined) {
        await logActivity(strapi, {
          mentionDocumentId: args.documentId,
          action: 'drafted',
          detail: { via: meta.via, chars: args.draftText.length },
        });
      }
      return { updated: true, documentId: args.documentId, changed };
    },
  },

  {
    name: 'pulse-save-drafts-bulk',
    title: 'Pulse: save several drafts in one call',
    description:
      'Save drafts for up to 25 mentions in ONE call (the queue grows faster than one-by-one ' +
      'writes clear it). Same conditional-write rule as pulse-save-draft: a mention that already ' +
      'has a draft is SKIPPED unless overwrite is true. Returns a per-item result.',
    access: 'write',
    subject: 'api::mention.mention',
    input: () =>
      z.object({
        drafts: z
          .array(z.object({ documentId: z.string(), draft: z.string().min(1).max(4000) }))
          .min(1)
          .max(25),
        overwrite: z.boolean().optional().describe('Replace existing drafts (default false = skip them)'),
      }),
    execute: async (strapi, args, meta) => {
      const results: any[] = [];
      for (const item of args.drafts) {
        const mention: any = await strapi
          .documents('api::mention.mention')
          .findOne({ documentId: item.documentId });
        if (!mention) {
          results.push({ documentId: item.documentId, saved: false, reason: 'not found' });
          continue;
        }
        if (mention.draftText && !args.overwrite) {
          results.push({ documentId: item.documentId, saved: false, reason: 'draft already exists' });
          continue;
        }
        await strapi.documents('api::mention.mention').update({
          documentId: item.documentId,
          data: { draftText: item.draft, draftedAt: new Date().toISOString(), draftedVia: meta.via } as any,
        });
        await logActivity(strapi, {
          mentionDocumentId: item.documentId,
          action: 'drafted',
          detail: { via: meta.via, chars: item.draft.length, bulk: true },
        });
        results.push({ documentId: item.documentId, saved: true });
      }
      return { saved: results.filter((r) => r.saved).length, total: args.drafts.length, results };
    },
  },

  {
    name: 'pulse-acknowledge',
    title: 'Pulse: acknowledge (close without a public reply)',
    description:
      'Close a mention deliberately without replying (competitor threads, off-topic, watch-list, or ' +
      'our own social posts). Keeps full analytics value EXCEPT for own-post, which is excluded from ' +
      'sentiment metrics. Legal only from unanswered/claimed — otherwise returns the current status ' +
      'so you can explain why.',
    access: 'write',
    subject: 'api::mention.mention',
    input: () =>
      z.object({
        documentId: z.string(),
        reason: z
          .enum(['competitor', 'not-relevant', 'watching', 'own-post'])
          .describe(
            "competitor = replying would look pushy; not-relevant = off-topic; watching = no reply " +
              "needed yet; own-post = OUR OWN social/marketing account (relevant but not repliable — " +
              'use this instead of not-relevant, and it keeps our announcements out of the sentiment metrics)'
          ),
        note: z.string().max(500).optional(),
      }),
    execute: async (strapi, args, meta) => {
      try {
        await (strapi.service('api::mention.mention') as any).acknowledge(
          args.documentId,
          { id: null },
          { reason: args.reason, note: args.note ? `${args.note} (via ${meta.via})` : `via ${meta.via}` }
        );
        return { acknowledged: true, documentId: args.documentId, reason: args.reason };
      } catch (err: any) {
        return { acknowledged: false, error: err.message, status: err.status ?? 500 };
      }
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
