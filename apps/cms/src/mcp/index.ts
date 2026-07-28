import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';

import { PULSE_TOOLS, toolAction, toolActionUid } from '../tools/registry';
import { asResult } from './constants';

/** App-level registration (a plugin is optional for custom MCP tools) —
 *  called from src/index.ts register(), before mcp.start().
 *  Every tool comes from the shared registry (src/tools/registry.ts) so the
 *  MCP surface and the in-app assistant always expose the same capabilities.
 *  Each tool is gated by its own admin permission action (see registry). */
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
        auth: { policies: [{ action: toolAction(tool) }] },
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

/** Bootstrap-phase: register one admin permission action per tool so the tools
 *  are individually grantable/revokable from the Admin Token UI
 *  (Settings tab → "Pulse MCP tools" category). */
export const registerMcpToolPermissions = async (strapi: Core.Strapi) => {
  try {
    await (strapi.service('admin::permission') as any).actionProvider.registerMany(
      PULSE_TOOLS.map((tool) => ({
        section: 'settings',
        category: 'Pulse MCP tools',
        uid: toolActionUid(tool),
        displayName: `${tool.title}${tool.access === 'write' ? ' (write)' : ''}`,
      }))
    );
    strapi.log.info(`[mcp] registered ${PULSE_TOOLS.length} tool permission actions (Settings → Pulse MCP tools)`);
  } catch (err: any) {
    strapi.log.error(`[mcp] tool permission registration failed: ${err.message}`);
  }
};
