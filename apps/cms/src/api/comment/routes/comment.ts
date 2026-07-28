import { factories } from '@strapi/strapi'

/** Create/update/delete only — comments are read through the parent mention's
 *  populate (findOne) and the search endpoint, never listed independently.
 *  update/delete are guarded by the is-owner middleware (own comments only). */
export default factories.createCoreRouter('api::comment.comment', {
  only: ['create', 'update', 'delete'],
  config: {
    update: { middlewares: ['api::comment.is-owner'] },
    delete: { middlewares: ['api::comment.is-owner'] },
  },
})
