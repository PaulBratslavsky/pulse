import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';

import { PULSE_TOOLS } from '../tools/registry';
import { readPolicy, writePolicy, asResult } from './constants';

/** App-level registration (a plugin is optional for custom MCP tools) —
 *  called from src/index.ts register(), before mcp.start().
 *  Every tool comes from the shared registry (src/tools/registry.ts) so the
 *  MCP surface and the in-app assistant always expose the same capabilities. */
export const registerAllMcpTools = (strapi: Core.Strapi) => {
  const mcp = (strapi as any).ai?.mcp;
  if (!mcp?.registerTool) {
    strapi.log.warn('[mcp] strapi.ai.mcp unavailable — is mcp.enabled set in config/server and Strapi ≥ 5.49?');
    return;
  }
  try {
    for (const tool of PULSE_TOOLS) {
      mcp.registerTool({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        auth: tool.access === 'write' ? writePolicy(tool.subject) : readPolicy(tool.subject),
        resolveInputSchema: () => tool.input(),
        resolveOutputSchema: () => z.object({ result: z.any() }),
        createHandler: (strapiInstance: Core.Strapi) => async ({ args }: any) =>
          asResult(await tool.execute(strapiInstance, args ?? {}, { via: 'mcp' })),
      } as any);
    }
    strapi.log.info(`[mcp] registered ${PULSE_TOOLS.length} Pulse tools on the built-in server`);
  } catch (err: any) {
    strapi.log.error(`[mcp] tool registration failed: ${err.message}`);
  }
};
