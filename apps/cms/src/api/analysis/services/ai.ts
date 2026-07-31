import type { Core } from '@strapi/strapi';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { model, modelVersion } from './provider';
import { laneRubric, QUALITY_RUBRIC, laneById } from '../../../classification/criteria';

/**
 * Provider-agnostic AI. **AI is optional**: no AI_API_KEY → these features are
 * DISABLED, not degraded — analyze()/draft() return null, callers 503 or mark
 * mentions 'skipped'. modelVersion records what produced each analysis (trend
 * integrity). Draft grounding: best-effort Strapi docs MCP lookup
 * (STRAPI_DOCS_MCP_URL, stateless JSON-RPC POST).
 *
 * Provider selection lives in ./provider.ts — this file never names a vendor.
 *
 * Classification is ONE call returning every field. Four calls would cost 4×
 * and let the judgements disagree with each other (a mention labelled `na` but
 * routed `respond`).
 */

// v2: structured output, 'na' label restored, lane + spam judgements, and the
// deterministic signals fed in as priors rather than discarded.
const PROMPT_VERSION = 'v3';

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

  async function docsLookup(question: string): Promise<string | null> {
    const url = process.env.STRAPI_DOCS_MCP_URL;
    if (!url) return null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: question } },
        }),
      });
      if (!res.ok) return null;
      const json: any = await res.json();
      return JSON.stringify(json.result ?? null)?.slice(0, 4000) ?? null;
    } catch {
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
      const docs = await docsLookup(String(mention.content).slice(0, 300));
      const grounded = docs
        ? `Relevant official docs context (from the Strapi docs MCP):\n${docs}\n\n`
        : 'No docs-MCP context available — cite specific https://docs.strapi.io pages you are confident exist.\n\n';

      const { text, usage } = await generateText({
        model: model(),
        system:
          'You draft public replies on behalf of the Strapi DevRel team. Warm, concise, technically precise. ' +
          'Ground every claim in official Strapi documentation and include doc links. ' +
          'A human will review and post this manually — never claim it was posted.',
        prompt: `${grounded}Mention from @${mention.authorHandle ?? 'user'}: "${mention.content}"\n\nDraft a reply:`,
        abortSignal: AbortSignal.timeout(60_000),
      });
      await charge(usage);
      return text;
    },
  };
};

export default ai;
