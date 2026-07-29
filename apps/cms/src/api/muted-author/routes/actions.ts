export default {
  routes: [
    { method: 'POST', path: '/muted-authors/mute', handler: 'muted-author.mute', config: { policies: [] } },
    { method: 'POST', path: '/muted-authors/rescan', handler: 'muted-author.rescan', config: { policies: [] } },
    {
      method: 'DELETE',
      path: '/muted-authors/:documentId/unmute',
      handler: 'muted-author.unmute',
      config: { policies: [] },
    },
  ],
}
