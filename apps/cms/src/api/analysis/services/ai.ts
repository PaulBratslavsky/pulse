import type { Core } from '@strapi/strapi';
import { generateObject, generateText, stepCountIs } from 'ai';
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

    /** Docs-grounded draft answer, or null when AI disabled. Never persisted — the human decides. */
    async draft(mention: any): Promise<string | null> {
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
      return audit.text;
    },
  };
};

export default ai;
