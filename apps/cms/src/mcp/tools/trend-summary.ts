import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';
import { readPolicy, asResult } from '../constants';

export const registerTrendSummaryTool = (strapi: Core.Strapi) => {
  strapi.ai.mcp.registerTool({
    name: 'pulse-trend-summary',
    title: 'Pulse: sentiment trend',
    description:
      'The Pulse sentiment score (0-100, trailing-7d volume-weighted, UTC days) over a date range, with annotated events.',
    auth: readPolicy('api::mention.mention'),
    resolveInputSchema: () =>
      z.object({
        from: z.string().optional().describe('ISO date, default 90 days ago'),
        to: z.string().optional().describe('ISO date, default now'),
        topic: z.string().optional().describe('Topic slug to filter by'),
      }),
    resolveOutputSchema: () => z.object({ result: z.any() }),
    createHandler: (strapiInstance: Core.Strapi) => async ({ args }: any) =>
      asResult(await (strapiInstance.service('api::analysis.insights') as any).trends(args)),
  } as any);
};
