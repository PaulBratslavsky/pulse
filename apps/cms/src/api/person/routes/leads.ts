export default {
  routes: [
    // /people before /people/leads is fine — Koa matches the literal segment
    // first — but the DIRECTORY must not shadow it, so keep both explicit.
    { method: 'GET', path: '/people', handler: 'person.directory', config: { policies: [] } },
    { method: 'GET', path: '/people/leads', handler: 'person.leads', config: { policies: [] } },
    { method: 'GET', path: '/people/leads-status', handler: 'person.leadsStatus', config: { policies: [] } },
    { method: 'POST', path: '/people/rescore', handler: 'person.rescore', config: { policies: [] } },
    { method: 'GET', path: '/people/:documentId', handler: 'person.detail', config: { policies: [] } },
    { method: 'POST', path: '/people/:documentId/status', handler: 'person.status', config: { policies: [] } },
    { method: 'PUT', path: '/people/:documentId/lead-profile', handler: 'person.saveLeadProfile', config: { policies: [] } },
    { method: 'POST', path: '/people/:documentId/suggest-identity', handler: 'person.suggestIdentity', config: { policies: [] } },
    { method: 'GET', path: '/people/:documentId/merge-candidates', handler: 'person.mergeCandidates', config: { policies: [] } },
    { method: 'POST', path: '/people/:documentId/merge', handler: 'person.merge', config: { policies: [] } },
  ],
}
