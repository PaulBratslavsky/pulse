/** Admin routes only: the brain's data is read through the MCP tools
 *  (src/tools/brain.ts in the app), so there is no content-API surface. */
export const routes = {
  admin: {
    type: 'admin',
    routes: [
      {
        // POST /brain/youtube/sync — run the sync now (the cron runs it daily
        // when BRAIN_YOUTUBE_SYNC=true). Gated by the plugin's own action,
        // grantable from Roles / Admin Token → Plugins tab → brain.
        method: 'POST',
        path: '/youtube/sync',
        handler: 'youtube.sync',
        config: {
          policies: [
            'admin::isAuthenticatedAdmin',
            { name: 'admin::hasPermissions', config: { actions: ['plugin::brain.youtube.sync'] } },
          ],
        },
      },
    ],
  },
};
