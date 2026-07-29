export default {
  routes: [
    {
      method: 'POST',
      path: '/dead-letters/:documentId/replay',
      handler: 'dead-letter.replay',
      config: { policies: [] },
    },
  ],
}
