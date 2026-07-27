export const contentApiRoutes = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/ingest',
      handler: 'webhook.receive',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/sync',
      handler: 'sync.trigger',
      config: { policies: [] },
    },
  ],
};
