import { factories } from '@strapi/strapi'

export default factories.createCoreRouter('api::response.response', {
  only: ['find', 'findOne', 'create'],
})
