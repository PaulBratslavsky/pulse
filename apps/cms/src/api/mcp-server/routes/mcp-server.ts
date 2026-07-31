export default {
  routes: [
    { method: 'GET', path: '/mcp-servers', handler: 'mcp-server.list', config: { policies: [] } },
    { method: 'POST', path: '/mcp-servers', handler: 'mcp-server.register', config: { policies: [] } },
    { method: 'POST', path: '/mcp-servers/:documentId/connect', handler: 'mcp-server.connect', config: { policies: [] } },
    { method: 'POST', path: '/mcp-servers/:documentId/finish-auth', handler: 'mcp-server.finishAuth', config: { policies: [] } },
    { method: 'POST', path: '/mcp-servers/:documentId/toggle', handler: 'mcp-server.toggle', config: { policies: [] } },
    { method: 'DELETE', path: '/mcp-servers/:documentId', handler: 'mcp-server.remove', config: { policies: [] } },
  ],
}
