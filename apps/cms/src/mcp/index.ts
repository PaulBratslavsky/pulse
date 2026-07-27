import type { Core } from '@strapi/strapi';

import { registerSearchMentionsTool } from './tools/search-mentions';
import { registerTrendSummaryTool } from './tools/trend-summary';
import { registerThemeReportTool } from './tools/theme-report';

/** App-level registration (a plugin is optional for custom MCP tools) —
 *  called from src/index.ts register(), before mcp.start(). */
export const registerAllMcpTools = (strapi: Core.Strapi) => {
  const mcp = (strapi as any).ai?.mcp;
  if (!mcp?.registerTool) {
    strapi.log.warn('[mcp] strapi.ai.mcp unavailable — is mcp.enabled set in config/server and Strapi ≥ 5.49?');
    return;
  }
  try {
    registerSearchMentionsTool(strapi);
    registerTrendSummaryTool(strapi);
    registerThemeReportTool(strapi);
    strapi.log.info('[mcp] registered 3 Pulse tools on the built-in server');
  } catch (err: any) {
    strapi.log.error(`[mcp] tool registration failed: ${err.message}`);
  }
};
