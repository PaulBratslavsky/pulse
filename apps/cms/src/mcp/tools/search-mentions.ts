import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';
import { readPolicy, asResult } from '../constants';

export const registerSearchMentionsTool = (strapi: Core.Strapi) => {
  strapi.ai.mcp.registerTool({
    name: 'pulse-search-mentions',
    title: 'Pulse: search mentions',
    description: 'Search Pulse mentions by text. Returns matching mentions with sentiment, status, and topics.',
    auth: readPolicy('api::mention.mention'),
    resolveInputSchema: () =>
      z.object({
        query: z.string().min(2).describe('Text to search mention content for'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      }),
    resolveOutputSchema: () => z.object({ result: z.any() }),
    createHandler: (strapiInstance: Core.Strapi) => async ({ args }: any) => {
      const mentions = await strapiInstance.documents('api::mention.mention').findMany({
        filters: { content: { $containsi: args.query } },
        fields: ['content', 'sentimentLabel', 'sentimentScore', 'status', 'postedAt', 'url'],
        populate: { topics: { fields: ['name'] }, channel: { fields: ['name'] } } as any,
        sort: 'postedAt:desc' as any,
        limit: args.limit ?? 20,
      });
      return asResult(mentions);
    },
  } as any);
};
