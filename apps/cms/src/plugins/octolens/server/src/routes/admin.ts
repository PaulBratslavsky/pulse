/** Admin routes gated by the plugin's own permission actions (registered in
 *  bootstrap.ts) — grantable per role/token from the admin UI, Plugins tab. */
export const adminRoutes = {
  type: 'admin',
  routes: [
    {
      method: 'POST',
      path: '/sync',
      handler: 'sync.adminTrigger',
      config: {
        policies: [
          'admin::isAuthenticatedAdmin',
          { name: 'admin::hasPermissions', config: { actions: ['plugin::octolens.sync.start'] } },
        ],
      },
    },
    {
      method: 'GET',
      path: '/status',
      handler: 'sync.status',
      config: {
        policies: [
          'admin::isAuthenticatedAdmin',
          { name: 'admin::hasPermissions', config: { actions: ['plugin::octolens.settings.read'] } },
        ],
      },
    },
  ],
};
