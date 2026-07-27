import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';
import { readPolicy, asResult } from '../constants';

export const registerThemeReportTool = (strapi: Core.Strapi) => {
  strapi.ai.mcp.registerTool({
    name: 'pulse-theme-report',
    title: 'Pulse: recurring themes',
    description: 'Recurring themes ranked by volume × negativity over a window (days), with evidence mention ids.',
    auth: readPolicy('api::topic.topic'),
    resolveInputSchema: () =>
      z.object({
        days: z.number().int().min(1).max(365).optional().describe('Window in days (default 30)'),
      }),
    resolveOutputSchema: () => z.object({ result: z.any() }),
    createHandler: (strapiInstance: Core.Strapi) => async ({ args }: any) =>
      asResult(await (strapiInstance.service('api::analysis.insights') as any).themes(args)),
  } as any);
};
