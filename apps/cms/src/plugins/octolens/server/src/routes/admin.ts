export const adminRoutes = {
  type: 'admin',
  routes: [
    {
      method: 'POST',
      path: '/sync',
      handler: 'sync.adminTrigger',
      config: { policies: ['admin::isAuthenticatedAdmin'] },
    },
    {
      method: 'GET',
      path: '/status',
      handler: 'sync.status',
      config: { policies: ['admin::isAuthenticatedAdmin'] },
    },
  ],
};
