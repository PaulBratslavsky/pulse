/**
 * API-scoped middleware — file path must stay src/api/mention/middlewares/
 * so the UID api::mention.populate-mention resolves (src/middlewares/ would be global::).
 */
export default () => async (ctx: any, next: () => Promise<void>) => {
  ctx.query.populate = {
    channel: { fields: ['name', 'key'] },
    topics: { fields: ['name', 'slug', 'kind'] },
    owner: { fields: ['username'] },
    assignee: { fields: ['username'] },
    responses: {
      fields: ['finalText', 'draftText', 'respondedAt', 'notes', 'internal'],
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
      populate: { author: { fields: ['username'] } },
      sort: 'createdAt:asc',
    },
  }
  await next()
}
