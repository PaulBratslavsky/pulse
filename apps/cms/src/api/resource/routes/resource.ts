export default {
  routes: [
    // the team's saved references
    { method: 'GET', path: '/resources', handler: 'resource.list', config: { policies: [] } },
    { method: 'POST', path: '/resources', handler: 'resource.save', config: { policies: [] } },
    { method: 'PUT', path: '/resources/:documentId', handler: 'resource.patch', config: { policies: [] } },
    { method: 'DELETE', path: '/resources/:documentId', handler: 'resource.remove', config: { policies: [] } },
    // live search of the marketing site, to find posts worth saving
    { method: 'GET', path: '/resources/source/search', handler: 'resource.searchSource', config: { policies: [] } },
    { method: 'POST', path: '/resources/refresh', handler: 'resource.refresh', config: { policies: [] } },
  ],
}
