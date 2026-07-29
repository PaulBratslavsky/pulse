export default {
  routes: [
    { method: 'GET', path: '/preferences/me', handler: 'preference.mine', config: { policies: [] } },
    { method: 'PUT', path: '/preferences/me', handler: 'preference.updateMine', config: { policies: [] } },
  ],
}
