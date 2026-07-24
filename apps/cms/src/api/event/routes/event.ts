import { factories } from '@strapi/strapi'
export default factories.createCoreRouter('api::event.event', {
  only: ['find', 'findOne'],
})
