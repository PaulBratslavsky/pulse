import type { Core } from '@strapi/strapi';

import { registerSearchMentionsTool } from './tools/search-mentions';
import { registerTrendSummaryTool } from './tools/trend-summary';
import { registerThemeReportTool } from './tools/theme-report';

export const registerAllMcpTools = (strapi: Core.Strapi) => {
  const mcp = (strapi as any).ai?.mcp;
  if (!mcp?.registerTool) {
    strapi.log.warn(
      '[pulse-mcp-tools] strapi.ai.mcp unavailable — is mcp.enabled set in config/server and Strapi ≥ 5.49?'
    );
    return;
  }
  try {
    registerSearchMentionsTool(strapi);
    registerTrendSummaryTool(strapi);
    registerThemeReportTool(strapi);
    strapi.log.info('[pulse-mcp-tools] registered 3 MCP tools on the built-in server');
  } catch (err: any) {
    strapi.log.error(`[pulse-mcp-tools] tool registration failed: ${err.message}`);
  }
};
