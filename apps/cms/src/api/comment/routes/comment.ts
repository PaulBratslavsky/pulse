import { factories } from '@strapi/strapi'

/** Create/update/delete — comments are read through the parent mention's
 *  populate (findOne) and the search endpoint, never listed independently.
 *  update/delete are guarded by the is-owner middleware (own comments only). */
export default factories.createCoreRouter('api::comment.comment', {
  only: ['find', 'create', 'update', 'delete'],
  config: {
    // registers comment.find so the READ permission counts when a mention
    // populates its comments; the route itself always refuses
    find: { policies: ['global::read-permission-only'] },
    update: { middlewares: ['api::comment.is-owner'] },
    delete: { middlewares: ['api::comment.is-owner'] },
  },
})
