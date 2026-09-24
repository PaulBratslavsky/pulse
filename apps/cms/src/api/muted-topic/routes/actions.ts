export default {
  routes: [
    { method: 'POST', path: '/muted-topics/mute', handler: 'muted-topic.mute', config: { policies: [] } },
    { method: 'POST', path: '/muted-topics/rescan', handler: 'muted-topic.rescan', config: { policies: [] } },
    {
      method: 'GET',
      path: '/muted-topics/suggestions',
      handler: 'muted-topic.suggestions',
      config: { policies: [] },
    },
    {
      method: 'DELETE',
      path: '/muted-topics/:documentId/unmute',
      handler: 'muted-topic.unmute',
      config: { policies: [] },
    },
  ],
}
