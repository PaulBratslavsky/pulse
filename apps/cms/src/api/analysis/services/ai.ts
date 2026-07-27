import type { Core } from '@strapi/strapi';

/**
 * Provider-agnostic AI interface. v1 provider: Anthropic, via fetch (no SDK
 * lock-in). **AI is optional**: no AI_API_KEY → these features are DISABLED,
 * not degraded — analyze()/draft() return null, callers 503 or mark mentions
 * 'skipped'. modelVersion records what produced each analysis (trend
 * integrity). Draft grounding: best-effort Strapi docs MCP lookup
 * (STRAPI_DOCS_MCP_URL, stateless JSON-RPC POST).
 */

const PROMPT_VERSION = 'v1';

export const aiEnabled = () => Boolean(process.env.AI_API_KEY);

export type Analysis = {
  score: number;
  label: 'positive' | 'neutral' | 'negative';
  topics: string[];
  modelVersion: string;
  promptVersion: string;
};

export const ai = ({ strapi }: { strapi: Core.Strapi }) => {
  const model = () => process.env.AI_MODEL || 'claude-sonnet-5';

  async function callAnthropic(system: string, user: string, maxTokens: number): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.AI_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json: any = await res.json();
    const tokens = (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0);
    await (strapi.service('api::analysis.budget') as any).add(tokens);
    return json.content?.[0]?.text ?? '';
  }

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

  return {
    /** AI features on/off — single source of truth for backend + frontend config. */
    enabled: () => aiEnabled(),

    /** → Analysis | null when AI disabled. Throws on provider/parse errors (sweep marks 'failed'). */
    async analyze(mention: any): Promise<Analysis | null> {
      if (!aiEnabled()) return null;
      const raw = await callAnthropic(
        'You analyze social mentions about the Strapi CMS. Reply with STRICT JSON only: ' +
          '{"score": <-1..1>, "label": "positive"|"neutral"|"negative", "topics": [<1-3 short topic names, e.g. "Docs", "Migrations", "Better Auth plugin">]}',
        `Mention: "${mention.content}"`,
        300
      );
      try {
        const parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ''));
        return {
          score: Math.max(-1, Math.min(1, Number(parsed.score) || 0)),
          label: ['positive', 'neutral', 'negative'].includes(parsed.label) ? parsed.label : 'neutral',
          topics: Array.isArray(parsed.topics) && parsed.topics.length ? parsed.topics.slice(0, 3) : ['General'],
          modelVersion: model(),
          promptVersion: PROMPT_VERSION,
        };
      } catch {
        throw new Error('unparseable provider output');
      }
    },

    /** Docs-grounded draft answer, or null when AI disabled. Never persisted — the human decides. */
    async draft(mention: any): Promise<string | null> {
      if (!aiEnabled()) return null;
      const docs = await docsLookup(String(mention.content).slice(0, 300));
      const grounded = docs
        ? `Relevant official docs context (from the Strapi docs MCP):\n${docs}\n\n`
        : 'No docs-MCP context available — cite specific https://docs.strapi.io pages you are confident exist.\n\n';
      return callAnthropic(
        'You draft public replies on behalf of the Strapi DevRel team. Warm, concise, technically precise. ' +
          'Ground every claim in official Strapi documentation and include doc links. ' +
          'A human will review and post this manually — never claim it was posted.',
        `${grounded}Mention from @${mention.authorHandle ?? 'user'}: "${mention.content}"\n\nDraft a reply:`,
        600
      );
    },
  };
};

export default ai;
