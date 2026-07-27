export const chatRoutes = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/chat',
      handler: 'chat.chat',
      config: { policies: [] },
    },
  ],
};
