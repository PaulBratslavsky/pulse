import { factories } from '@strapi/strapi'

/** Read the list; create/delete go through the mute/unmute actions (they own
 *  the retroactive re-marking), never the raw core routes. */
export default factories.createCoreRouter('api::muted-author.muted-author', { only: ['find'] })
