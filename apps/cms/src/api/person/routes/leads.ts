export default {
  routes: [
    { method: 'GET', path: '/people/leads', handler: 'person.leads', config: { policies: [] } },
    { method: 'GET', path: '/people/leads-status', handler: 'person.leadsStatus', config: { policies: [] } },
    { method: 'POST', path: '/people/rescore', handler: 'person.rescore', config: { policies: [] } },
    { method: 'GET', path: '/people/:documentId', handler: 'person.detail', config: { policies: [] } },
    { method: 'POST', path: '/people/:documentId/status', handler: 'person.status', config: { policies: [] } },
  ],
}
