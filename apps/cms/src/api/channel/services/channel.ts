import { factories } from '@strapi/strapi'

/** ensure(): single creator for channels (same race-safe pattern as topic.ensure). */
export default factories.createCoreService('api::channel.channel', ({ strapi }) => ({
  async ensure(key: string, name: string) {
    let channel = await strapi.documents('api::channel.channel').findFirst({ filters: { key } })
    if (!channel) {
      try {
        channel = await strapi.documents('api::channel.channel').create({ data: { key, name } as any })
        strapi.log.info(`[channels] auto-created channel '${key}'`)
      } catch (err) {
        channel = await strapi.documents('api::channel.channel').findFirst({ filters: { key } })
        if (!channel) throw err
      }
    }
    return channel
  },
}))
