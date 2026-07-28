import { factories } from '@strapi/strapi'

/** Only create is exposed — comments are read through the parent mention's
 *  populate (findOne) and the search endpoint, never listed independently. */
export default factories.createCoreRouter('api::comment.comment', {
  only: ['create'],
})
