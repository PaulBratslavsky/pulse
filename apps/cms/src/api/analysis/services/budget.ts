import type { Core } from '@strapi/strapi';

/** Daily AI token budget: warn ops at 80%, callers halt non-essential work at
 *  100% (new-mention analysis always continues — spec rule). */

const utcDay = () => new Date().toISOString().slice(0, 10);

export const budget = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = () => strapi.store({ type: 'plugin', name: 'analysis' });
  const limit = () => Number(process.env.AI_DAILY_TOKEN_BUDGET || 0);

  return {
    async add(tokens: number) {
      if (!tokens) return;
      const key = `usage:${utcDay()}`;
      const current = Number((await store().get({ key })) || 0);
      await store().set({ key, value: current + tokens });
      const max = limit();
      if (max > 0) {
        const spent = current + tokens;
        const warnedKey = `warned:${utcDay()}`;
        if (spent >= max * 0.8 && !(await store().get({ key: warnedKey }))) {
          await store().set({ key: warnedKey, value: true });
          await (strapi.service('api::notify.slack') as any)
            .ops(`AI budget at ${Math.round((spent / max) * 100)}% (${spent}/${max} tokens today)`)
            .catch(() => {});
        }
      }
    },
    async status() {
      const spent = Number((await store().get({ key: `usage:${utcDay()}` })) || 0);
      const max = limit();
      return { spent, budget: max, exceeded: max > 0 && spent >= max };
    },
    async reset() {
      await store().set({ key: `usage:${utcDay()}`, value: 0 });
      await store().set({ key: `warned:${utcDay()}`, value: false });
    },
  };
};

export default budget;
