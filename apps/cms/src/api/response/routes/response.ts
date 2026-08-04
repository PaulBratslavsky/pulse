import { factories } from '@strapi/strapi'

/**
 * Responses are read through the parent mention's populate and the search
 * endpoint, never listed independently — so `find`/`findOne` stay for search
 * and `update`/`delete` are guarded to the person who recorded the reply.
 */
export default factories.createCoreRouter('api::response.response', {
  only: ['find', 'findOne', 'create', 'update', 'delete'],
  config: {
    update: { middlewares: ['api::response.is-owner'] },
    delete: { middlewares: ['api::response.is-owner'] },
  },
})
