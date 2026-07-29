import { factories } from '@strapi/strapi'
import { sendWorkflowError } from '../../../utils/workflow-error'

/** Thin controllers — all workflow rules live in the response service. */
export default factories.createCoreController('api::response.response', ({ strapi }) => ({
  async create(ctx) {
    try {
      const body = ctx.request.body?.data ?? ctx.request.body ?? {}
      const data = await (strapi.service('api::response.response') as any).record(ctx.state.user, body)
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },

  async outcome(ctx) {
    try {
      const { result, notes } = ctx.request.body ?? {}
      const data = await (strapi.service('api::response.response') as any).recordOutcome(
        ctx.state.user,
        ctx.params.documentId,
        { result, notes }
      )
      return { data }
    } catch (err) {
      return sendWorkflowError(ctx, err)
    }
  },
}))
