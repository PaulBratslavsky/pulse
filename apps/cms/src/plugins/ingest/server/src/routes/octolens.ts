export const octolensRoutes = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/octolens',
      handler: 'octolens.receive',
      config: { auth: false, policies: [] },
    },
  ],
};
