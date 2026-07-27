export default {
  routes: [
    {
      method: 'POST',
      path: '/assistant/chat',
      handler: 'chat.chat',
      config: { policies: [] },
    },
  ],
}
