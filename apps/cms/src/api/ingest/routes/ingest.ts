export default {
  routes: [
    {
      method: 'POST',
      path: '/ingest/octolens',
      handler: 'octolens.receive',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/ingest/octolens-sync',
      handler: 'octolens.sync',
      config: { policies: [] },
    },
  ],
}
