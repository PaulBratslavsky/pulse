import { factories } from '@strapi/strapi'
export default factories.createCoreRouter('api::activity.activity', {
  only: ['find', 'findOne'],
})
