import { factories } from '@strapi/strapi'

const KINDS = ['release', 'launch', 'incident']

export default factories.createCoreController('api::event.event', ({ strapi }) => ({
  /** POST /events — { title, date, kind?, notes? }.
   *  Validating action rather than the core create: the core route accepts any
   *  field on the type, and these annotations land on a chart the whole team
   *  reads. */
  async add(ctx) {
    const { title, date, kind, notes } = ctx.request.body ?? {}

    const cleanTitle = String(title ?? '').trim()
    if (!cleanTitle) return ctx.badRequest('title is required')
    if (cleanTitle.length > 120) return ctx.badRequest('title must be 120 characters or fewer')

    const when = new Date(String(date ?? ''))
    if (!date || Number.isNaN(when.getTime())) return ctx.badRequest('a valid date is required')

    if (kind && !KINDS.includes(kind)) return ctx.badRequest(`kind must be one of ${KINDS.join(', ')}`)

    const data = await strapi.documents('api::event.event').create({
      data: {
        title: cleanTitle,
        date: when.toISOString(),
        kind: kind ?? 'release',
        notes: notes ? String(notes).trim().slice(0, 1000) : null,
      } as any,
    })
    return { data }
  },
}))
