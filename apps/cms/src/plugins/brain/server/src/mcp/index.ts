import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';

import { BRAIN_TOOLS, type BrainTool } from './tools';

/**
 * Puts the brain's tools on Strapi's built-in MCP server (`POST /mcp`, needs
 * `server.mcp.enabled`), each behind its own permission action. Both run from
 * the plugin's register(): the MCP server only accepts tools before it starts
 * (after every plugin's bootstrap), and admin's bootstrap prunes token grants
 * for actions that aren't registered yet, which wiped token checkboxes on every
 * restart when tool actions were registered in bootstrap (2026-07-28).
 */

export const toolActionUid = (tool: BrainTool) => `tools.${tool.name.replace(/^brain-/, '')}`;
export const toolAction = (tool: BrainTool) => `plugin::brain.${toolActionUid(tool)}`;

/**
 * MCP clients reject a result over ~1 MB with an opaque error the agent can't
 * act on, and the payload goes over the wire twice (text + structuredContent),
 * so a doubled size over the limit returns an actionable notice instead.
 */
const MAX_WIRE_BYTES = 950_000;

const asResult = (data: unknown) => {
  const wireBytes = Buffer.byteLength(JSON.stringify(data ?? null), 'utf8') * 2 + 2048;
  const payload =
    wireBytes > MAX_WIRE_BYTES
      ? {
          error: 'RESULT_TOO_LARGE',
          bytes: wireBytes,
          limitBytes: MAX_WIRE_BYTES,
          message: `This result is ~${(wireBytes / 1_000_000).toFixed(2)} MB on the wire, over the ~1 MB MCP limit. Re-issue with a smaller limit or a narrower filter.`,
        }
      : data;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: { result: payload },
  };
};

export const registerToolPermissions = async (strapi: Core.Strapi) => {
  await (strapi.service('admin::permission') as any).actionProvider.registerMany(
    BRAIN_TOOLS.map((tool) => ({
      section: 'plugins',
      pluginName: 'brain',
      subCategory: 'MCP tools',
      uid: toolActionUid(tool),
      displayName: `${tool.title}${tool.access === 'write' ? ' (write)' : ''}`,
    }))
  );
};

export const registerTools = (strapi: Core.Strapi) => {
  const mcp = (strapi as any).ai?.mcp;
  if (!mcp?.registerTool) {
    strapi.log.warn('[brain] the MCP server is unavailable, so the brain tools are not registered');
    return;
  }
  for (const tool of BRAIN_TOOLS) {
    mcp.registerTool({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      auth: { policies: [{ action: toolAction(tool) }] },
      resolveInputSchema: () => tool.input(),
      resolveOutputSchema: () => z.object({ result: z.any() }),
      createHandler: (s: Core.Strapi) => async ({ args }: any) =>
        asResult(await tool.execute(s, args ?? {}, { via: 'mcp' })),
    } as any);
  }
  strapi.log.info(`[brain] registered ${BRAIN_TOOLS.length} MCP tools`);
};
