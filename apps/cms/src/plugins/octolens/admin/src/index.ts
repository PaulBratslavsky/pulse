import { Cog } from '@strapi/icons';

const PLUGIN_ID = 'octolens';

export default {
  register(app: any) {
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: Cog,
      intlLabel: { id: `${PLUGIN_ID}.plugin.name`, defaultMessage: 'Octolens' },
      // hidden for admins whose role lacks the plugin's read permission
      permissions: [{ action: `plugin::${PLUGIN_ID}.settings.read`, subject: null }],
      Component: async () => {
        const { HomePage } = await import('./pages/HomePage');
        return HomePage;
      },
    });

    app.registerPlugin({ id: PLUGIN_ID, name: 'Octolens' });

    // Homepage widget (Strapi ≥ 5.13) — guarded so older admins just skip it.
    try {
      if (app.widgets?.register) {
        app.widgets.register({
          id: 'octolens-sync',
          pluginId: PLUGIN_ID,
          icon: Cog,
          title: { id: `${PLUGIN_ID}.widget.title`, defaultMessage: 'Octolens sync' },
          permissions: [{ action: `plugin::${PLUGIN_ID}.settings.read` }],
          component: async () => {
            const { SyncWidget } = await import('./components/SyncWidget');
            return SyncWidget;
          },
        });
      }
    } catch {
      // widget API shape changed — the plugin page still works
    }
  },
  bootstrap() {},
};
