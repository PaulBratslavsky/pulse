import { factories } from '@strapi/strapi'

/**
 * No public routes on purpose.
 *
 * Accounts are reached THROUGH their person — the leads board and the person
 * page populate them — so exposing a second way in would be a second thing to
 * permission and keep in sync. The admin panel still manages them.
 */
export default factories.createCoreRouter('api::social-account.social-account', {
  only: [],
})
