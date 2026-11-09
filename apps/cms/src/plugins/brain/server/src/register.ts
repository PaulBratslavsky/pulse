import type { Core } from '@strapi/strapi';

import { registerToolPermissions, registerTools } from './mcp';

/**
 * Everything the plugin exposes, registered by the plugin itself:
 * - `plugin::brain.youtube.sync`, gating the on-demand sync route
 * - one action per MCP tool, `plugin::brain.tools.<name>`, and the tools
 * All on the Roles / Admin Token screens → Plugins tab → brain.
 *
 * Registered in register(), not bootstrap(): admin's bootstrap prunes grants
 * whose action is not registered yet, which wiped token checkboxes on every
 * restart when tool actions were registered in bootstrap (2026-07-28).
 */
export const register = async ({ strapi }: { strapi: Core.Strapi }) => {
  await (strapi.service('admin::permission') as any).actionProvider.registerMany([
    {
      section: 'plugins',
      pluginName: 'brain',
      uid: 'youtube.sync',
      displayName: 'Run the YouTube sync',
    },
  ]);
  await registerToolPermissions(strapi);
  registerTools(strapi);
};
