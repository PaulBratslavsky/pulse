export default {
  routes: [
    {
      method: 'PUT',
      path: '/responses/:documentId/outcome',
      handler: 'response.outcome',
      config: { policies: [] },
    },
  ],
}
