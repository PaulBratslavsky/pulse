export default {
  routes: [
    { method: 'GET', path: '/insights/trends', handler: 'insights.trends', config: { policies: [] } },
    { method: 'GET', path: '/insights/themes', handler: 'insights.themes', config: { policies: [] } },
    { method: 'GET', path: '/insights/stale', handler: 'insights.stale', config: { policies: [] } },
  ],
}
