export default {
  routes: [
    { method: 'GET', path: '/insights/trends', handler: 'insights.trends', config: { policies: [] } },
    { method: 'GET', path: '/insights/themes', handler: 'insights.themes', config: { policies: [] } },
    { method: 'GET', path: '/insights/stale', handler: 'insights.stale', config: { policies: [] } },
    { method: 'GET', path: '/insights/feedback', handler: 'insights.feedback', config: { policies: [] } },
    { method: 'GET', path: '/insights/leaderboard', handler: 'insights.leaderboard', config: { policies: [] } },
    { method: 'GET', path: '/insights/snapshot', handler: 'insights.snapshot', config: { policies: [] } },
    { method: 'GET', path: '/insights/config', handler: 'insights.config', config: { policies: [] } },
  ],
}
