export default {
  routes: [
    { method: 'GET', path: '/people/leads', handler: 'person.leads', config: { policies: [] } },
    { method: 'GET', path: '/people/leads-status', handler: 'person.leadsStatus', config: { policies: [] } },
    { method: 'POST', path: '/people/rescore', handler: 'person.rescore', config: { policies: [] } },
    { method: 'GET', path: '/people/:documentId', handler: 'person.detail', config: { policies: [] } },
    { method: 'POST', path: '/people/:documentId/status', handler: 'person.status', config: { policies: [] } },
    { method: 'GET', path: '/people/:documentId/merge-candidates', handler: 'person.mergeCandidates', config: { policies: [] } },
    { method: 'POST', path: '/people/:documentId/merge', handler: 'person.merge', config: { policies: [] } },
  ],
}
