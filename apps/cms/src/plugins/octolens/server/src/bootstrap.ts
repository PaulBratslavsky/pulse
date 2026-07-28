import type { Core } from '@strapi/strapi';

/**
 * Granular admin permissions for the Octolens plugin (official pattern:
 * strapi.io/blog/how-to-extend-strapi-s-mcp-server-with-a-custom-tools-via-a-plugin).
 * Registered with pluginName → actionIds `plugin::octolens.<uid>`, shown on the
 * Admin Token / Role screens under the Plugins tab → octolens.
 *
 * uid `sync.start` (not `sync.trigger`) — the content-api route already owns the
 * U&P permission string `plugin::octolens.sync.trigger`; keeping the admin action
 * textually distinct avoids confusing the two registries.
 */
export const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  await (strapi.service('admin::permission') as any).actionProvider.registerMany([
    {
      section: 'plugins',
      pluginName: 'octolens',
      uid: 'settings.read',
      displayName: 'Read sync status & reports',
    },
    {
      section: 'plugins',
      pluginName: 'octolens',
      uid: 'sync.start',
      displayName: 'Trigger a sync',
    },
  ]);
};
