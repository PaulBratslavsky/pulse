import { factories } from '@strapi/strapi'

export default factories.createCoreRouter('api::mention.mention', {
  only: ['find', 'findOne'],
  config: {
    find: { middlewares: ['api::mention.populate-mention'] },
    findOne: { middlewares: ['api::mention.populate-mention'] },
  },
})
