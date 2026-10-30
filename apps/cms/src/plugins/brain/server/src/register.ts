import type { Core } from '@strapi/strapi';

/**
 * The plugin's own admin permission action, `plugin::brain.youtube.sync`
 * (Roles / Admin Token screens → Plugins tab → brain). It gates the on-demand
 * sync route only; the MCP tools have their own per-tool actions, registered
 * with the rest of the registry from src/index.ts.
 *
 * Registered in register(), not bootstrap(): admin's bootstrap prunes grants
 * whose action is not registered yet, which wiped token checkboxes on every
 * restart when the MCP tool actions were registered in bootstrap (2026-07-28).
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
};
