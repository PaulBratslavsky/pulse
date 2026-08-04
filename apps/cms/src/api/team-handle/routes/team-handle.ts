import { factories } from '@strapi/strapi'

/** Read-only over the API; the admin panel is where the list is edited. */
export default factories.createCoreRouter('api::team-handle.team-handle', {
  only: ['find'],
})
