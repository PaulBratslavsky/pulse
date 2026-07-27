export default {
  routes: [
    {
      method: 'POST',
      path: '/mentions/:documentId/claim',
      handler: 'mention.claim',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/mentions/:documentId/route',
      handler: 'mention.route',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/mentions/:documentId/acknowledge',
      handler: 'mention.acknowledge',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/mentions/:documentId/correct',
      handler: 'mention.correct',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/mentions/:documentId/replay',
      handler: 'mention.replay',
      config: { policies: [] },
    },
    {
      method: 'POST',
      path: '/mentions/:documentId/draft',
      handler: 'mention.draft',
      config: { policies: [] },
    },
  ],
}
