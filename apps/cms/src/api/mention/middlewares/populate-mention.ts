/**
 * API-scoped middleware — file path must stay src/api/mention/middlewares/
 * so the UID api::mention.populate-mention resolves (src/middlewares/ would be global::).
 *
 * Two profiles (review 2026-07-28): the queue LIST renders 25 cards and needs
 * only card data + a comment count — populating full responses/activities/
 * comments for every row was the detail payload times 25. findOne keeps the
 * full detail shape.
 */
const LIST_POPULATE = {
  channel: { fields: ['name', 'key'] },
  topics: { fields: ['name', 'slug', 'kind'] },
  owner: { fields: ['username'] },
  assignee: { fields: ['username'] },
  comments: { count: true, filters: { archived: { $ne: true } } },
}

const DETAIL_POPULATE = {
  channel: { fields: ['name', 'key'] },
  topics: { fields: ['name', 'slug', 'kind'] },
  owner: { fields: ['username'] },
  assignee: { fields: ['username'] },
  // detail only, deliberately: one join on one row, so a mention can reach its
  // author. On the LIST this would be 25 extra joins to render a card that
  // shows the handle it already has.
  //
  // leadProfile comes with it because the moment you would decide to work
  // someone is while reading their post — so the detail page has to be able to
  // say whether one exists without a second request.
  person: {
    fields: ['displayName', 'status', 'leadScore', 'leadBand'],
    populate: { leadProfile: true },
  },
  responses: {
    fields: ['finalText', 'draftText', 'respondedAt', 'notes', 'internal', 'editedAt'],
    // withdrawn replies stay in the database but leave every read path, the
    // same soft-delete contract comments use
    filters: { archived: { $ne: true } },
    populate: {
      respondedBy: { fields: ['username'] },
      outcome: true,
    },
  },
  activities: {
    fields: ['action', 'detail', 'at'],
    populate: { actor: { fields: ['username'] } },
    sort: 'at:desc',
  },
  comments: {
    fields: ['kind', 'body', 'links', 'createdAt', 'editedAt'],
    filters: { archived: { $ne: true } }, // soft-deleted comments stay in the DB, never in the API
    populate: { author: { fields: ['username'] } },
    sort: 'createdAt:asc',
  },
}

export default () => async (ctx: any, next: () => Promise<void>) => {
  const isList = ctx.state?.route?.handler === 'api::mention.mention.find'
  ctx.query.populate = isList ? LIST_POPULATE : DETAIL_POPULATE
  await next()
}
