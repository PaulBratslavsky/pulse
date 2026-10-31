import type { Core } from '@strapi/strapi';

/**
 * Seed the phase-1 channels into an empty table. Non-fatal: a failed seed costs
 * a manual entry in the Content Manager, never the boot.
 */
export const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  await (strapi.plugin('brain').service('youtube') as any)
    .seedChannels()
    .catch((err: Error) => strapi.log.error(`[brain] channel seed failed: ${err.message}`));
};
