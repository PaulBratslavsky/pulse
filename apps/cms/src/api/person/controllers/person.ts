import { factories } from '@strapi/strapi'
import { primaryAccount, widestReach, aliasesOf } from '../../../utils/accounts'

export default factories.createCoreController('api::person.person', ({ strapi }) => ({
  /** GET /people/leads — the leads board, ordered by score. */
  async leads(ctx) {
    const { band, status, direction } = ctx.query as Record<string, string>
    const filters: any = {
      kind: { $in: ['community', 'unknown'] },
      mergedInto: { $null: true },
      $or: [
        // people with no intent signal at all are not leads; showing them would
        // bury the 30-odd rows that matter under 300 that don't
        { leadScore: { $gt: 0 } },
        // ...but a person somebody WORKED stays, whatever the score says.
        // Intent decays to zero at 90 days, so a lead researched in July would
        // otherwise drop off the board in October — silently, and precisely
        // because a human had invested in it.
        { leadProfile: { startedAt: { $notNull: true } } },
      ],
    }
    if (band) filters.leadBand = band
    if (status) filters.status = status

    const people = await strapi.documents('api::person.person').findMany({
      filters,
      populate: { owner: true, leadProfile: true, socialAccounts: { populate: { channel: true } } } as any,
      sort: ['leadScore:desc', 'lastSeenAt:desc'] as any,
      limit: 200,
    })

    const shaped = people
      .map((p: any) => {
        // one card, one identity: the presence they are actually using
        const primary = primaryAccount(p.socialAccounts)
        const reach = widestReach(p.socialAccounts)
        return {
        documentId: p.documentId,
        handle: primary?.handle ?? null,
        displayName: p.displayName,
        profileUrl: primary?.profileUrl ?? null,
        avatarUrl: primary?.avatarUrl ?? null,
        channel: primary?.channel?.key ?? null,
        // how many places they post from — the card says "+2 more" rather than
        // pretending the primary is all of them
        accountCount: (p.socialAccounts ?? []).length,
        leadScore: p.leadScore,
        leadBand: p.leadBand,
        reachTier: reach.reachTier,
        followers: reach.followers,
        leadContext: p.leadContext ?? {},
        status: p.status,
        owner: p.owner ? { id: p.owner.id, username: p.owner.username } : null,
        mentionCount: p.mentionCount,
        lastSeenAt: p.lastSeenAt,
        direction: (p.leadContext as any)?.direction ?? 'none',
        // Enough for the card to show that someone is working this and whether
        // it is reachable — but not the email itself. The board is a list
        // everyone scans; an address belongs on the page you opened on purpose.
        profile: p.leadProfile?.startedAt
          ? {
              started: true,
              hasEmail: Boolean(p.leadProfile.email),
              company: p.leadProfile.company ?? null,
            }
          : null,
        }
      })
      .filter((p: any) => !direction || p.direction === direction)

    return { data: shaped }
  },

  /**
   * GET /people — the directory.
   *
   * Distinct from /people/leads on purpose. The board answers "who is worth
   * looking at", ordered by a score; this answers "where is the person I am
   * already thinking of", ordered by recency and searched by name. A directory
   * sorted by lead score is useless for that, and a board that lists all 480
   * people is useless for the other.
   *
   * Query: q, profile=any|started|reachable|none, status, limit.
   */
  async directory(ctx) {
    const { q, profile, status } = ctx.query as Record<string, string>
    const limit = Math.min(Number(ctx.query.limit) || 60, 200)

    const filters: any = {
      mergedInto: { $null: true },
      // Brands, bots and our own accounts are not people you reach out to, and
      // they are the highest-frequency authors in the corpus — unfiltered they
      // would fill the first screen of every search.
      kind: { $in: ['community', 'unknown'] },
    }
    if (status) filters.status = status
    if (profile === 'started') filters.leadProfile = { startedAt: { $notNull: true } }
    if (profile === 'reachable') filters.leadProfile = { email: { $notNull: true } }
    if (profile === 'none') filters.leadProfile = { startedAt: { $null: true } }
    // Audience is a FILTER, never a sort. Only 23% of accounts carry a follower
    // count and 98% of those are on X, so ordering by reach would rank people
    // by which platform they happen to post on and leave three quarters of them
    // tied at the bottom — the same trap leadScore refuses for the same reason.
    if (ctx.query.audience === 'known') filters.socialAccounts = { followers: { $notNull: true } }
    if (ctx.query.lead === 'yes') filters.leadScore = { $gt: 0 }

    // Tier is derived from the WIDEST account (widestReach), but a relation
    // filter matches ANY related row — so `socialAccounts.reachTier = small`
    // would also return someone with 40k on X and 200 on dev.to. The DB filter
    // is therefore only a narrowing superset, and the exact answer is settled
    // below against the derived tier. Over-fetch so the post-filter still has
    // a full page to slice.
    const tier = String(ctx.query.tier ?? '')
    if (tier) filters.socialAccounts = { reachTier: tier }

    const term = String(q ?? '').trim()
    if (term) {
      // handle lives on the ACCOUNT now, so a name search has to reach through
      // the relation or it silently misses everyone whose display name is null
      filters.$or = [
        { displayName: { $containsi: term } },
        { socialAccounts: { handle: { $containsi: term } } },
        { leadProfile: { company: { $containsi: term } } },
        { leadProfile: { email: { $containsi: term } } },
      ]
    }

    const people = await strapi.documents('api::person.person').findMany({
      filters,
      populate: { owner: true, leadProfile: true, socialAccounts: { populate: { channel: true } } } as any,
      sort: ['lastSeenAt:desc'] as any,
      limit: tier ? Math.min(limit * 4, 400) : limit,
    })

    const rows = people.map((p: any) => {
        const primary = primaryAccount(p.socialAccounts)
        const reach = widestReach(p.socialAccounts)
        return {
          documentId: p.documentId,
          displayName: p.displayName,
          handle: primary?.handle ?? null,
          profileUrl: primary?.profileUrl ?? null,
          avatarUrl: primary?.avatarUrl ?? null,
          channel: primary?.channel?.key ?? null,
          aliases: aliasesOf(p.socialAccounts),
          mentionCount: p.mentionCount,
          lastSeenAt: p.lastSeenAt,
          leadScore: p.leadScore,
          leadBand: p.leadBand,
          // which way the intent points, when we know — "leaving" is worth
          // seeing in a directory as much as "coming toward us"
          direction: (p.leadContext as any)?.direction ?? 'none',
          // Reach comes WITH the account it belongs to. A bare "38k" on someone
          // who posts from three platforms says nothing about where they have
          // an audience, and `followers: null` must read as "we were never told"
          // rather than as zero — Reddit reports it for 2 accounts in 187.
          reachTier: reach.reachTier,
          followers: reach.followers,
          reachOn: reach.account?.channel?.name ?? reach.account?.channel?.key ?? null,
          status: p.status,
          owner: p.owner ? { username: p.owner.username } : null,
          profile: p.leadProfile?.startedAt
            ? {
                started: true,
                hasEmail: Boolean(p.leadProfile.email),
                company: p.leadProfile.company ?? null,
                role: p.leadProfile.role ?? null,
              }
            : null,
        }
    })

    // the exact tier answer, against the derived (widest) value
    return { data: (tier ? rows.filter((r: any) => r.reachTier === tier) : rows).slice(0, limit) }
  },

  /** GET /people/:documentId — one person with their mentions and notes. */
  async detail(ctx) {
    const person: any = await strapi.documents('api::person.person').findOne({
      documentId: ctx.params.documentId,
      populate: {
        owner: true,
        leadProfile: { populate: { researchedBy: true } },
        mentions: { populate: { channel: true } },
        socialAccounts: { populate: { channel: true } },
      } as any,
    })
    if (!person) return ctx.notFound('person not found')
    // Returned under `comments` / `activities` so the person page can render
    // the SAME Timeline component the mention detail uses — one timeline
    // implementation, not two that drift.
    const comments = await strapi.documents('api::comment.comment').findMany({
      filters: { person: { documentId: person.documentId } } as any,
      populate: { author: true } as any,
      sort: 'createdAt:asc' as any,
    })
    const activities = await strapi.documents('api::activity.activity').findMany({
      filters: { person: { documentId: person.documentId } } as any,
      populate: { actor: true } as any,
      sort: 'at:asc' as any,
    })

    // Their whole conversation history, newest first — the reason to open this
    // page at all is to read what someone has actually been saying.
    const mentions = [...((person as any).mentions ?? [])].sort(
      (a: any, b: any) =>
        new Date(b.postedAt ?? b.receivedAt ?? 0).getTime() -
        new Date(a.postedAt ?? a.receivedAt ?? 0).getTime()
    )

    const primary = primaryAccount(person.socialAccounts)
    const reach = widestReach(person.socialAccounts)

    return {
      data: {
        ...person,
        mentions,
        owner: person.owner ? { id: person.owner.id, username: person.owner.username } : null,
        comments,
        activities,
        // Flattened for the header, which needs one of each — while `aliases`
        // carries every presence, so a person who posts from three platforms
        // reads as one human with three accounts rather than a mystery.
        handle: primary?.handle ?? null,
        profileUrl: primary?.profileUrl ?? null,
        avatarUrl: primary?.avatarUrl ?? null,
        channel: primary?.channel ?? null,
        followers: reach.followers,
        reachTier: reach.reachTier,
        aliases: aliasesOf(person.socialAccounts),
      },
    }
  },

  /** PUT /people/:documentId/lead-profile — { email?, company?, companyDomain?, role?, intentSummary? } */
  async saveLeadProfile(ctx) {
    const body = ctx.request.body ?? {}
    if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email).trim())) {
      return ctx.badRequest('that does not look like an email address')
    }
    try {
      const data = await (strapi.service('api::person.leads') as any).saveLeadProfile(
        ctx.params.documentId,
        body,
        ctx.state.user
      )
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      return ctx.badRequest(err.message)
    }
  },

  /**
   * POST /people/:documentId/suggest-identity — read their posts for company/role.
   *
   * Returns suggestions and writes NOTHING. Accepting one is a separate,
   * deliberate act through the normal save, which is what stamps it `inferred`
   * in `sources` — so the provenance always reflects what actually happened
   * rather than what was offered.
   */
  async suggestIdentity(ctx) {
    const person: any = await strapi.documents('api::person.person').findOne({
      documentId: ctx.params.documentId,
      populate: { mentions: true } as any,
    })
    if (!person) return ctx.notFound('person not found')

    const aiService = strapi.service('api::analysis.ai') as any
    if (!aiService.enabled()) {
      return ctx.serviceUnavailable('AI is disabled — set AI_API_KEY to use suggestions')
    }
    const suggestions = await aiService.suggestIdentity(person.mentions ?? [])
    return { data: suggestions ?? [] }
  },

  /** POST /people/:documentId/status — { status } */
  async status(ctx) {
    try {
      const data = await (strapi.service('api::person.leads') as any).setStatus(
        ctx.params.documentId,
        ctx.request.body?.status,
        ctx.state.user
      )
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      return ctx.badRequest(err.message)
    }
  },


  /**
   * POST /people/:documentId/merge — { into }
   *
   * The param is the person being FOLDED AWAY and `into` is the survivor, so
   * the URL names the row that disappears from the board. Merging is
   * human-confirmed on purpose: the boot repair only folds a provisional row
   * into a firm one on the same channel, and joining an X account to a Reddit
   * account has no reliable automatic signal.
   */
  async merge(ctx) {
    const into = String(ctx.request.body?.into ?? '')
    if (!into) return ctx.badRequest('into is required')
    try {
      const data = await (strapi.service('api::person.person') as any).merge(
        ctx.params.documentId,
        into,
        ctx.state.user
      )
      return { data }
    } catch (err: any) {
      if (err.status === 404) return ctx.notFound(err.message)
      if (err.status === 409) return ctx.conflict(err.message)
      return ctx.badRequest(err.message)
    }
  },

  /**
   * GET /people/:documentId/merge-candidates — plausible same-person rows.
   *
   * Suggestions only, and deliberately weak ones: same handle (any channel), or
   * the same display name. A stronger heuristic would invite trusting it, and
   * the cost of a wrong merge is paid by whoever has to unpick it.
   */
  async mergeCandidates(ctx) {
    const person: any = await strapi.documents('api::person.person').findOne({
      documentId: ctx.params.documentId,
      populate: { socialAccounts: true } as any,
    })
    if (!person) return ctx.notFound('person not found')

    // Match on ANY of their handles, not just the primary one: a person who
    // already holds two accounts should still surface a third.
    const handles: string[] = (person.socialAccounts ?? [])
      .map((a: any) => (a.handle ?? '').trim().replace(/^@+/, ''))
      .filter(Boolean)

    const or: any[] = []
    if (handles.length) or.push({ socialAccounts: { handle: { $in: handles } } })
    if (person.displayName) or.push({ displayName: { $eqi: person.displayName } })
    if (!or.length) return { data: [] }

    const rows = await strapi.documents('api::person.person').findMany({
      filters: { $or: or, mergedInto: { $null: true } } as any,
      populate: { socialAccounts: { populate: { channel: true } } } as any,
      limit: 10,
    })
    const lower = handles.map((h) => h.toLowerCase())
    return {
      data: rows
        .filter((r: any) => r.documentId !== person.documentId)
        .map((r: any) => {
          const accounts = r.socialAccounts ?? []
          const primary = primaryAccount(accounts)
          return {
            documentId: r.documentId,
            handle: primary?.handle ?? null,
            displayName: r.displayName,
            identityKey: primary?.identityKey ?? null,
            identityProvisional: Boolean(primary?.identityProvisional),
            channel: primary?.channel?.key ?? null,
            accountCount: accounts.length,
            mentionCount: r.mentionCount,
            leadScore: r.leadScore,
            // why it is being suggested, so nobody merges on faith
            because: accounts.some((a: any) => lower.includes((a.handle ?? '').toLowerCase()))
              ? 'same handle'
              : 'same display name',
          }
        }),
    }
  },

  /** GET /people/leads-status — freshness of the board, for the Settings card. */
  async leadsStatus(ctx) {
    return { data: await (strapi.service('api::person.leads') as any).status() }
  },

  /** POST /people/rescore — pure arithmetic over stored rows, no model calls. */
  async rescore(ctx) {
    const count = await (strapi.service('api::person.leads') as any).rescoreAll()
    return { data: { scored: count } }
  },
}))
