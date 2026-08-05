import type { Core } from '@strapi/strapi';
import { generateObject, generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { model, modelVersion } from './provider';
import { laneRubric, QUALITY_RUBRIC, laneById } from '../../../classification/criteria';
import { shortlistDocsUrls, stripDeadDocsLinks, keepRealDocsUrls } from '../../../utils/docs-links';

/**
 * Provider-agnostic AI. **AI is optional**: no AI_API_KEY → these features are
 * DISABLED, not degraded — analyze()/draft() return null, callers 503 or mark
 * mentions 'skipped'. modelVersion records what produced each analysis (trend
 * integrity).
 *
 * Draft grounding is TWO independent things, deliberately:
 *   - prose: best-effort Strapi docs MCP lookup (STRAPI_DOCS_MCP_URL). Optional,
 *     OAuth-gated, and allowed to fail.
 *   - links: the docs sitemap (utils/docs-links). NOT optional and never
 *     model-authored — see that file for the 404s that made this necessary.
 *
 * Provider selection lives in ./provider.ts — this file never names a vendor.
 *
 * Classification is ONE call returning every field. Four calls would cost 4×
 * and let the judgements disagree with each other (a mention labelled `na` but
 * routed `respond`).
 */

// v2: structured output, 'na' label restored, lane + spam judgements, and the
// deterministic signals fed in as priors rather than discarded.
const PROMPT_VERSION = 'v4';

export const aiEnabled = () => Boolean(process.env.AI_API_KEY || process.env.AI_BASE_URL);

/**
 * Chat is a SEPARATE switch from classification.
 *
 * They used to share one flag, so setting a key to enable auto-labelling also
 * turned the assistant on — a tool-calling agent going live as a side effect of
 * a labelling change. Off unless AI_CHAT_ENABLED is explicitly 'true'.
 */
export const chatEnabled = () => aiEnabled() && process.env.AI_CHAT_ENABLED === 'true';

/**
 * `spam` is deliberately absent: it hides a mention from the queue AND from
 * every metric, so confirming it stays a human action. The model may only
 * raise a flag for review — the same rule the MCP write tools follow.
 */
export type Classification = {
  score: number;
  label: 'positive' | 'neutral' | 'negative' | 'na';
  topics: string[];
  lane: 'respond' | 'lead' | 'monitor';
  laneReason: string;
  laneEvidence?: string | null;
  leadDirection?: 'none' | 'open' | 'toward-us' | 'away-from-us' | null;
  quality: 'normal' | 'suspected-spam';
  qualityReason?: string | null;
};

/** What someone states about THEMSELVES in their own posts, with the quote. */
export type IdentityFindings = {
  findings: {
    field: 'company' | 'role';
    value: string;
    evidence: string;
    post: number;
  }[];
};

// Annotated for the same reason as ClassificationSchema below: inferring
// through it trips TS2589.
const IdentitySchema: z.ZodType<IdentityFindings> = z.object({
  findings: z
    .array(
      z.object({
        field: z.enum(['company', 'role']),
        value: z.string().describe('The company name or role title, as short as it can be'),
        evidence: z
          .string()
          .describe("The author's own words, copied EXACTLY from one post, that state this"),
        post: z.number().int().describe('Index of the post the quote came from'),
      })
    )
    .max(6),
});

// Annotated rather than inferred: letting generateObject infer through a schema
// this wide trips TS2589 ("type instantiation is excessively deep"). Naming the
// shape collapses the inference and documents the contract in one place.
const ClassificationSchema: z.ZodType<Classification> = z.object({
  score: z
    .number()
    .min(-1)
    .max(1)
    .describe('Sentiment toward Strapi: -1 hostile, 0 neutral, 1 delighted. 0 when not about Strapi.'),
  label: z
    .enum(['positive', 'neutral', 'negative', 'na'])
    .describe("'na' = not about Strapi at all (competitor-only discourse, ads, unrelated news)"),
  topics: z
    .array(z.string().min(2).max(40))
    .min(1)
    .max(3)
    .describe('Reuse an existing topic name when one fits; invent only for a genuinely new theme'),
  lane: z
    .enum(['respond', 'lead', 'monitor'])
    .describe(
      "'respond' = a human should reply; 'lead' = someone shopping, migrating, or unhappy with a " +
        "competitor's pricing; 'monitor' = commentary, news reaction, ads — real signal, but not reply work"
    ),
  // 400, not 200: at 200 the model's own reasoning ran over the limit and
  // generateObject threw NoObjectGeneratedError — 2 of the first 5 real
  // mentions failed that way. A schema constraint tighter than the model's
  // natural output is a guaranteed error rate, not a guardrail.
  laneReason: z.string().max(400).describe('One short sentence justifying the lane'),
  // A verbatim quote from the mention showing stated intent. Required for
  // 'lead' and verified server-side against the text: a model cannot quote a
  // phrase that isn't there, which is a hard check rather than a hope.
  laneEvidence: z
    .string()
    .max(300)
    .nullable()
    .optional()
    .describe("For 'lead' only: the exact words from the mention showing intent to change. Null otherwise."),
  // Which way the intent points. A field, not a penalty: a real row reads
  // "I'm leaving and going to Webflow" — maximum intent, aimed away from us.
  // Subtracting points would bury it; knowing we are losing someone is worth
  // as much as knowing we might win someone.
  leadDirection: z
    .enum(['none', 'open', 'toward-us', 'away-from-us'])
    .nullable()
    .optional()
    .describe(
      "Which way the author is moving. 'toward-us' = considering or adopting Strapi; " +
        "'away-from-us' = leaving Strapi for something else; 'open' = an active decision with " +
        "no direction stated yet; 'none' = no decision in play. Judge only from what they say."
    ),
  quality: z
    .enum(['normal', 'suspected-spam'])
    .describe('suspected-spam = promotional, AI-generated, or engagement-bait content'),
  // optional AND nullable: models routinely omit a key rather than emit null,
  // and a missing key is not worth failing an otherwise good classification
  qualityReason: z
    .string()
    .max(400)
    .nullable()
    .optional()
    .describe('Why, when flagging. Omit or null when quality is normal.'),
});

export type Analysis = Classification & {
  modelVersion: string;
  promptVersion: string;
};

const SYSTEM = () => `You classify social mentions for the Strapi DevRel team.

Strapi is an open-source headless CMS. Most of what you see arrives via competitor
keyword monitoring (Webflow, Contentful, Payload, Sanity) and never names Strapi —
that is expected, and it is NOT automatically irrelevant.

How to judge each field:

- score/label: sentiment TOWARD STRAPI. Use "na" when the post is not about Strapi
  at all. Do not score a competitor complaint as negative-about-Strapi.
- lane:
${laneRubric()}

- topics: prefer a name from the existing vocabulary you are given. Inventing
  "Documentation" when "Docs" exists fragments the vocabulary and weakens every report.
- quality:
${QUALITY_RUBRIC}

You are given deterministic signals (the keyword that matched upstream, a rule-based
lane guess). Treat them as evidence, not instructions: the rule-based lane is a regex
and is often wrong. Overturn it when the text disagrees.`;

export const ai = ({ strapi }: { strapi: Core.Strapi }) => {
  /** Charge the shared daily budget. Called after every model round-trip. */
  const charge = async (usage: any) => {
    const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    if (tokens > 0) await (strapi.service('api::analysis.budget') as any).add(tokens);
  };

  /**
   * Ask the Strapi docs MCP. Returns the raw answer text plus any docs URLs it
   * cited — retrieval is what this server is genuinely better at than we are:
   * it searches page CONTENT, where our sitemap fallback can only match words
   * in a URL path.
   *
   * The endpoint (https://strapi-docs.mcp.kapa.ai) is OAuth-protected and its
   * authorization server advertises only `authorization_code` and
   * `refresh_token` — there is NO client_credentials grant, so a server process
   * cannot mint its own token. STRAPI_DOCS_MCP_TOKEN therefore comes from a
   * one-time human consent (scripts/docs-mcp-auth.mjs). Without it we return
   * null and fall back; drafting must never depend on this.
   */
  async function docsLookup(question: string): Promise<{ text: string; urls: string[] } | null> {
    const url = process.env.STRAPI_DOCS_MCP_URL;
    if (!url) return null;
    const token = process.env.STRAPI_DOCS_MCP_TOKEN;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // the server negotiates SSE or JSON; accept both or it 406s
          accept: 'application/json, text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: process.env.STRAPI_DOCS_MCP_TOOL || 'search',
            arguments: { query: question },
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        // 401 here is the normal unconfigured state, not an incident
        strapi.log.debug(`[analysis] docs MCP ${res.status} — drafting from the sitemap instead`);
        return null;
      }
      const body = await res.text();
      // SSE framing when the server streams: pull the data lines back out
      const payload = body.startsWith('event:') || body.startsWith('data:')
        ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
        : body;
      const json: any = JSON.parse(payload);
      const text = JSON.stringify(json.result ?? '').slice(0, 4000);
      const urls = [...new Set(text.match(/https?:\/\/docs\.strapi\.io\/[^"\s\\)]+/g) ?? [])];
      return { text, urls };
    } catch (err: any) {
      strapi.log.debug(`[analysis] docs MCP unavailable: ${err.message}`);
      return null;
    }
  }

  /**
   * The signals we already hold for free. Feeding them in is the difference
   * between asking a model to guess and asking it to adjudicate: the matched
   * keyword tag comes from Octolens and is authoritative, and the existing
   * vocabulary is what stops topic drift.
   */
  function buildPrompt(mention: any, vocabulary: string[]): string {
    const keywords = Array.isArray(mention.matchedKeywords)
      ? mention.matchedKeywords.map((k: any) => `${k.keyword} (${k.keywordTag})`).join(', ')
      : '';
    return [
      vocabulary.length ? `Existing topic vocabulary: ${vocabulary.join(', ')}` : '',
      keywords ? `Upstream keyword match: ${keywords}` : '',
      mention.channel?.name ? `Channel: ${mention.channel.name}` : '',
      mention.authorHandle ? `Author: @${mention.authorHandle}` : '',
      mention.lane ? `Rule-based lane guess: ${mention.lane} (${mention.laneReason ?? 'no reason'})` : '',
      '',
      `Mention:\n"""${String(mention.content ?? '').slice(0, 6000)}"""`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return {
    /** AI features on/off — single source of truth for backend + frontend config. */
    enabled: () => aiEnabled(),

    /** Chat/assistant on/off — independent of classification. */
    chatEnabled: () => chatEnabled(),

    /** → Analysis | null when AI disabled. Throws on provider/schema errors (sweep marks 'failed'). */
    async analyze(mention: any, vocabulary: string[] = []): Promise<Analysis | null> {
      if (!aiEnabled()) return null;

      // `schema as any`: AI SDK 7's generics instantiate too deeply over a zod-3
      // object this wide and trip TS2589. The cast is confined to this one call
      // and costs nothing in safety — `object` is re-typed as Classification
      // below, and the SDK still validates the model's output against the real
      // schema at runtime, which is where it matters.
      const { object, usage } = await generateObject({
        model: model(),
        schema: ClassificationSchema as any,
        system: SYSTEM(),
        prompt: buildPrompt(mention, vocabulary),
        // a classification that takes longer than this is a hung connection,
        // not a slow model — the sweep retries with a capped attempt count
        abortSignal: AbortSignal.timeout(30_000),
      });
      await charge(usage);

      const result = object as Classification;

      // Verify the lead claim instead of trusting it. 'lead' is the lane that
      // gets read first, so a false one costs attention; the model must quote
      // the author's own words showing an open decision, and that quote has to
      // actually appear in the mention. Inferred intent ("signals potential
      // dissatisfaction") cannot survive this, which is exactly the failure
      // mode observed: 4 of 8 early leads were complaints or already-completed
      // migrations, not people shopping.
      if (laneById(result.lane)?.requiresEvidence) {
        const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
        const body = norm(String(mention.content ?? ''));
        const quote = norm(String(result.laneEvidence ?? ''));
        const grounded = quote.length >= 8 && body.includes(quote);
        if (!grounded) {
          result.laneReason = `demoted from ${result.lane}: no verbatim evidence in the text (${result.laneReason})`;
          result.lane = 'monitor';
        }
      }

      return { ...result, modelVersion: modelVersion(), promptVersion: PROMPT_VERSION };
    },

    /**
     * Read a person's own posts for who they are — company and role.
     *
     * SUGGESTIONS, never writes. Octolens carries no company or role, so the
     * only place either could come from is the author stating it themselves,
     * and people do: "we run our marketing site on Webflow", "I'm the only dev
     * here". That is worth surfacing and worth nothing without the quote.
     *
     * Same gate as the lead lane (ai.ts analyze): the model must quote the
     * author verbatim and the quote is checked against the text server-side. A
     * plausible-sounding inference cannot survive that, which is the entire
     * point — this feeds a field a human will later act on, and "sounds like a
     * founder" is not a company name.
     *
     * On demand only, never on ingest: it would be a second model call on every
     * mention to fill a field almost nobody has, and the daily budget is shared
     * with classification, which is load-bearing.
     */
    async suggestIdentity(
      mentions: { content?: string | null; url?: string | null; postedAt?: string | null }[]
    ): Promise<{ field: 'company' | 'role'; value: string; evidence: string; url?: string | null }[] | null> {
      if (!aiEnabled()) return null;
      const usable = mentions.filter((m) => String(m.content ?? '').trim()).slice(0, 20);
      if (!usable.length) return [];

      const numbered = usable
        .map((m, i) => `[${i}] ${String(m.content).slice(0, 800)}`)
        .join('\n\n');

      let object: any;
      let usage: any;
      try {
        ({ object, usage } = await generateObject({
          model: model(),
          schema: IdentitySchema as any,
          system:
            'You extract who someone is from what they wrote, for a sales researcher who will verify it. ' +
            'Report ONLY what the author states about THEMSELVES — their employer, their job. ' +
            'A company they are evaluating, complaining about, or merely naming is NOT their employer. ' +
            'Quote their exact words as evidence; a quote that is not in the text is worse than no finding. ' +
            'Return an empty array when nobody says anything about themselves, which is the common case.',
          prompt: `Posts by one person:\n\n${numbered}\n\nWhat do they say about who they are?`,
          abortSignal: AbortSignal.timeout(30_000),
        }));
      } catch (err: any) {
        strapi.log.warn(`[analysis] identity extraction failed: ${err.message}`);
        return [];
      }
      await charge(usage);

      // Verify, do not trust. Identical treatment to laneEvidence: normalize
      // whitespace, then require the quote to actually appear in the post it
      // claims to come from.
      const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
      const out: { field: 'company' | 'role'; value: string; evidence: string; url?: string | null }[] = [];
      for (const f of object?.findings ?? []) {
        const source = usable[f.post];
        if (!source) continue;
        const quote = norm(String(f.evidence ?? ''));
        if (quote.length < 8 || !norm(String(source.content ?? '')).includes(quote)) {
          strapi.log.debug(`[analysis] dropped unquoted identity finding: ${f.field}=${f.value}`);
          continue;
        }
        if (!String(f.value ?? '').trim()) continue;
        out.push({
          field: f.field,
          value: String(f.value).trim().slice(0, 120),
          evidence: String(f.evidence).trim(),
          url: source.url ?? null,
        });
      }
      return out;
    },

    /**
     * Docs-grounded draft answer, or null when AI disabled. Never persisted —
     * the human decides.
     *
     * Returns `grounded` alongside the text, the same way refine() does. Without
     * it "the docs server is connected but the draft does not seem to use it" is
     * unanswerable: a draft with no links looks identical whether the model
     * searched and found nothing worth citing, or had no tools at all. `sources`
     * is how many real doc URLs the draft was allowed to choose from.
     */
    async draft(
      mention: any
    ): Promise<{ text: string; grounded: boolean; sources: number; sourceUrls: string[] } | null> {
      if (!aiEnabled()) return null;
      const content = String(mention.content);

      // Registered MCP servers (Settings → MCP servers) become callable tools,
      // so the model can look things up itself instead of us guessing once up
      // front what it will need. Falls back to the legacy single-shot lookup
      // when nothing is registered.
      const loaded = await (strapi.service('api::analysis.mcp-tools') as any).load();
      const docs = Object.keys(loaded.tools).length
        ? null
        : await docsLookup(content.slice(0, 300));

      // Retrieval and verification are separate jobs, done by the tool that is
      // actually good at each:
      //   - WHICH page is relevant  → the MCP searches page content. Our
      //     sitemap fallback can only match words in a URL path, which ranks
      //     'admin-panel/favicon' highly for an ecommerce question.
      //   - IS this URL real        → the sitemap, always. The MCP cannot
      //     guarantee the model transcribes a URL correctly, and it is
      //     OAuth-gated so it can simply be absent.
      // Whatever the MCP cites is filtered against the sitemap too: a citation
      // is a suggestion, never a warrant.
      let allowed: string[] = [];
      try {
        const fromMcp = docs?.urls?.length ? await keepRealDocsUrls(docs.urls) : [];
        allowed = fromMcp.length ? fromMcp : await shortlistDocsUrls(content, 12);
        if (fromMcp.length) strapi.log.debug(`[analysis] ${fromMcp.length} link(s) from the docs MCP`);
      } catch (err: any) {
        strapi.log.warn(`[analysis] docs sitemap unavailable, drafting without links: ${err.message}`);
      }

      const linkRule = allowed.length
        ? `You may link ONLY to these real documentation pages. Copy a URL exactly, character for character. ` +
          `Never modify, shorten, or invent one — and if none of them fits, write the reply with no link at all:\n${allowed
            .map((u) => `  ${u}`)
            .join('\n')}\n\n`
        : `Do NOT include any documentation URL in this reply — the link list could not be loaded, and a wrong link is worse than no link.\n\n`;

      const grounded = docs?.text
        ? `Relevant official docs context (from the Strapi docs MCP):\n${docs.text}\n\n`
        : '';

      const hasTools = Object.keys(loaded.tools).length > 0;
      let text: string;
      let usage: any;
      try {
        ({ text, usage } = await generateText({
          model: model(),
          system:
            'You draft public replies on behalf of the Strapi DevRel team. Warm, concise, technically precise. ' +
            'Ground every claim in official Strapi documentation. ' +
            (hasTools
              ? 'You have documentation search tools — use them before making a technical claim, and prefer what they return over what you remember. '
              : '') +
            'A human will review and post this manually — never claim it was posted.',
          prompt: `${grounded}${linkRule}Mention from @${mention.authorHandle ?? 'user'}: "${content}"\n\nDraft a reply:`,
          ...(hasTools
            ? {
                tools: loaded.tools,
                // a few hops is enough to look something up; more is a loop
                stopWhen: stepCountIs(5),
              }
            : {}),
          abortSignal: AbortSignal.timeout(90_000),
        }));
      } finally {
        // leaks sockets otherwise, on the error path especially
        await loaded.close();
      }
      await charge(usage);

      // Belt and braces: instructions constrain a model, they do not bind it.
      // Anything that is not a real page is removed before a human ever sees it.
      const audit = await stripDeadDocsLinks(text);
      if (audit.removed.length) {
        strapi.log.warn(
          `[analysis] draft for ${mention.documentId ?? '?'} cited ${audit.removed.length} non-existent docs URL(s), removed: ${audit.removed.join(', ')}`
        );
      }
      strapi.log.info(
        `[analysis] drafted ${mention.documentId ?? '?'} — docs tools: ${hasTools ? loaded.servers.join(', ') || 'yes' : 'none'}, ${allowed.length} link(s) offered`
      );
      // The URLs themselves, not just how many. "12 links offered" is a claim a
      // reader cannot check, and the whole point of the sitemap allow-list is
      // that these are pages we verified exist — so show them.
      return { text: audit.text, grounded: hasTools, sources: allowed.length, sourceUrls: allowed };
    },

    /**
     * Polish a reply the human already wrote.
     *
     * Deliberately NOT draft(): draft() answers the mention, this one edits an
     * existing answer. The distinction matters because the failure mode here is
     * the model quietly replacing someone's judgement with its own — so the
     * instruction is to preserve meaning, keep their voice, and change nothing
     * it cannot justify. The caller keeps the original and can revert.
     *
     * Same tools and the same link verification as draft(): a refined reply is
     * the one most likely to be posted verbatim, so it is the LAST place a
     * fabricated URL should survive.
     */
    async refine(
      mention: any,
      replyText: string
    ): Promise<{ text: string; grounded: boolean } | null> {
      if (!aiEnabled()) return null;
      const reply = String(replyText).trim();
      if (!reply) return null;
      const content = String(mention.content ?? '');

      const loaded = await (strapi.service('api::analysis.mcp-tools') as any).load();
      const hasTools = Object.keys(loaded.tools).length > 0;

      let allowed: string[] = [];
      try {
        allowed = await shortlistDocsUrls(`${content} ${reply}`, 12);
      } catch {
        /* no links rather than invented ones */
      }

      const linkRule = allowed.length
        ? `If a documentation link genuinely helps, use ONLY these real pages, copied exactly:\n${allowed
            .map((u) => `  ${u}`)
            .join('\n')}\nDo not invent or modify a URL. No link is better than a wrong one.\n\n`
        : `Do NOT add any documentation URL.\n\n`;

      let text: string;
      let usage: any;
      try {
        ({ text, usage } = await generateText({
          model: model(),
          system:
            'You are an editor for the Strapi DevRel team. You improve a reply someone has ALREADY written. ' +
            'Preserve their meaning, their decisions and their voice — you are not rewriting it as you would have. ' +
            'Fix technical inaccuracies, tighten wording, and correct anything factually wrong. ' +
            'Keep roughly the same length unless it is padded. ' +
            // Without this, a refine pass PRESERVED "mongodb works fine too"
            // and strengthened it to "if you prefer it over Postgres" — Strapi
            // does not support MongoDB or any NoSQL database. Inheriting a
            // false claim from the input is the worst failure this feature has,
            // because the output is what gets posted.
            'Never strengthen, endorse or elaborate a technical claim you cannot verify. ' +
            'If the reply asserts something you believe is wrong or unsupported, correct it; ' +
            'if you are unsure, remove the claim rather than repeating it. ' +
            (hasTools
              ? 'Use the documentation tools to check every technical claim before you keep it. '
              : // Telling an ungrounded model to "be conservative" does not work:
                // asked to refine a reply saying "mongodb works fine too", it
                // kept the claim AND elaborated it to "if you prefer it over
                // Postgres" — Strapi supports no NoSQL database at all. So with
                // no tools the job is narrowed to something it cannot get
                // wrong: grammar, tone and structure. A human's own claim may
                // stand as they wrote it; what we must never do is lend it
                // extra authority it did not have.
                'You have NO documentation tools, so you may ONLY fix grammar, spelling, tone and ' +
                'structure. Copy every technical statement across VERBATIM — do not expand, ' +
                'qualify, justify or add to any of them, and do not introduce a technical claim ' +
                'the reply does not already make. ') +
            'Return ONLY the improved reply — no preamble, no commentary, no explanation of your edits.',
          prompt:
            `The mention being replied to (@${mention.authorHandle ?? 'user'}):\n"${content}"\n\n` +
            `${linkRule}Their reply to improve:\n---\n${reply}\n---\n\nReturn the improved reply:`,
          ...(hasTools ? { tools: loaded.tools, stopWhen: stepCountIs(5) } : {}),
          abortSignal: AbortSignal.timeout(90_000),
        }));
      } finally {
        await loaded.close();
      }
      await charge(usage);

      const audit = await stripDeadDocsLinks(text);
      if (audit.removed.length) {
        strapi.log.warn(
          `[analysis] refine cited ${audit.removed.length} non-existent docs URL(s), removed: ${audit.removed.join(', ')}`
        );
      }
      // `grounded` is reported so the UI can say plainly whether the technical
      // claims were checked against the docs or merely rephrased.
      return { text: audit.text.trim(), grounded: hasTools };
    },

    /**
     * Refine a reply by TALKING about it.
     *
     * refine() above is one-shot and mute: you press it and something happens to
     * your words. You cannot say "shorter", you cannot say "they're on v4, does
     * this still apply?", and you cannot ask the docs a question without leaving
     * the reply box — which is where the answer was actually needed. So people
     * asked kapa in another window and pasted, and the reply lost the mention.
     *
     * The design decision that matters: an answer is not an edit. The model
     * replies in prose like any assistant, and when it wants to change YOUR text
     * it must call `propose_revision` — a tool, not a side effect. So:
     *
     *   - "does v5 still need the plugin?" is answered, and the draft is untouched
     *   - "cut the second paragraph" comes back as a proposal you apply or ignore
     *
     * Nothing here writes to the mention or the textarea. The caller applies a
     * revision on a human click and keeps the previous text for undo, the same
     * contract refine() has, because the failure this feature invites is the
     * model quietly replacing someone's judgement over several friendly turns.
     */
    async chatRefine(
      mention: any,
      replyText: string,
      history: { role: 'user' | 'assistant'; content: string }[]
    ): Promise<{
      reply: string;
      revision: string | null;
      grounded: boolean;
      sources: number;
    } | null> {
      if (!aiEnabled()) return null;
      const turns = (Array.isArray(history) ? history : [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content ?? '').trim())
        .slice(-12)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
      if (!turns.length) return null;

      const current = String(replyText ?? '').trim();
      const content = String(mention.content ?? '');

      const loaded = await (strapi.service('api::analysis.mcp-tools') as any).load();
      const hasTools = Object.keys(loaded.tools).length > 0;

      // Same allow-list as draft()/refine(): the model never authors a URL, it
      // picks from pages we have confirmed exist.
      let allowed: string[] = [];
      try {
        allowed = await shortlistDocsUrls(`${content} ${current} ${turns.map((t) => t.content).join(' ')}`, 12);
      } catch {
        /* no links rather than invented ones */
      }

      // Captured from the tool call rather than parsed out of prose — the model
      // cannot half-propose, and a turn with no call is unambiguously a turn
      // that changed nothing.
      // an object, not a bare `let`: TypeScript cannot see the assignment
      // happen inside the tool callback and narrows the variable to never
      const captured: { text: string | null } = { text: null };

      const tools: Record<string, any> = {
        ...loaded.tools,
        propose_revision: tool({
          description:
            'Propose a replacement for the reply the human is writing. Call this ONLY when they asked for a ' +
            'change to the reply itself. Pass the COMPLETE new reply, not a fragment or a description of the edit.',
          inputSchema: z.object({
            text: z.string().describe('The complete revised reply, ready to post.'),
            what_changed: z.string().describe('One short line: what you changed and why.'),
          }) as any,
          execute: async ({ text, what_changed }: any) => {
            captured.text = String(text ?? '');
            return { ok: true, note: what_changed };
          },
        }),
      };

      let text: string;
      let usage: any;
      try {
        ({ text, usage } = await generateText({
          model: model(),
          system:
            'You are helping a Strapi DevRel team member write ONE reply to ONE social media mention. ' +
            'You are talking with them about that reply — answer their questions directly and briefly. ' +
            'Their reply is theirs: preserve their meaning, decisions and voice. ' +
            'When they ask for a CHANGE to the reply, call propose_revision with the complete new text. ' +
            'When they ask a QUESTION, just answer it — do not call propose_revision, and do not rewrite anything. ' +
            'Never strengthen, endorse or elaborate a technical claim you cannot verify; ' +
            'if you are unsure of a claim, say so rather than repeating it. ' +
            (hasTools
              ? 'You have documentation tools — check technical claims against them before making or keeping one. '
              : 'You have NO documentation tools, so say plainly when something needs checking rather than asserting it. ') +
            (allowed.length
              ? `If a documentation link genuinely helps, use ONLY these real pages, copied exactly:\n${allowed
                  .map((u) => `  ${u}`)
                  .join('\n')}\nDo not invent or modify a URL.`
              : 'Do NOT put any documentation URL in a revision.'),
          messages: [
            {
              role: 'user',
              content:
                `The mention being replied to (@${mention.authorHandle ?? 'user'} on ${mention.source ?? 'social'}):\n"${content}"\n\n` +
                (current
                  ? `Their reply so far:\n---\n${current}\n---`
                  : 'They have not written anything yet.'),
            },
            { role: 'assistant', content: 'Understood — what would you like to change or know?' },
            ...turns,
          ],
          tools,
          stopWhen: stepCountIs(6),
          abortSignal: AbortSignal.timeout(120_000),
        }));
      } finally {
        await loaded.close();
      }
      await charge(usage);

      // A proposal is the text most likely to be posted verbatim, so it gets the
      // same link audit as a draft — this is exactly where chat-authored drafts
      // used to slip a dead URL through.
      let revision: string | null = null;
      if (captured.text && captured.text.trim()) {
        const audit = await stripDeadDocsLinks(captured.text);
        if (audit.removed.length) {
          strapi.log.warn(
            `[analysis] chat revision cited ${audit.removed.length} non-existent docs URL(s), removed: ${audit.removed.join(', ')}`
          );
        }
        revision = audit.text.trim();
        // An unchanged "revision" is noise in the UI and an Apply button that
        // does nothing.
        if (revision === current) revision = null;
      }

      return {
        reply:
          text?.trim() ||
          (revision ? 'Updated the reply — see the proposed change below.' : 'I did not get anywhere with that — try asking more specifically.'),
        revision,
        grounded: hasTools,
        sources: allowed.length,
      };
    },
  };
};

export default ai;
