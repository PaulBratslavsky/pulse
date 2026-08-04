import type { Core } from '@strapi/strapi';
import { generateText, stepCountIs, tool } from 'ai';

import { PULSE_TOOLS } from '../../../tools/registry';
import { model } from '../../analysis/services/provider';

/**
 * Chat with the data — an agentic tool-use loop over the SAME tool registry the
 * MCP server exposes (src/tools/registry.ts): queue, mention detail, save-draft,
 * search, trends, themes, plus whatever external MCP servers are connected.
 *
 * Three things were wrong here and they had one cause: this was a hand-rolled
 * Anthropic tool-use loop, so it drifted from the path draft() and refine()
 * take.
 *
 *   - It named a vendor. `AI_PROVIDER` and `AI_BASE_URL` configure the drafter
 *     and did nothing for chat, so one setting meant two things.
 *   - It never loaded the external MCP servers. Settings promises they give
 *     "chat and the reply drafter" real tools; only the drafter got them, so
 *     chat could not consult the docs it was telling people to read.
 *   - It took a single question. The UI sends the whole conversation and the
 *     controller passed only the last message, so chat rendered a conversation
 *     it could not remember — "and what about the second one?" was unanswerable.
 *
 * It now goes through generateText with the same provider, the same MCP tools
 * and real message history, which fixes all three by deleting the divergence
 * rather than patching it.
 */

const SYSTEM = [
  "You are Pulse, the Strapi team's mention-sentiment assistant, talking to a team member inside the Pulse app.",
  'Use the tools to answer from real data — never guess numbers. Be concise and concrete.',
  'When asked to draft a reply: pull the mention with pulse-get-mention, match the tone of similarPastReplies,',
  'and save with pulse-save-draft. Drafts are reviewed and posted by a human — never claim anything was posted.',
  'For competitor threads, recommend an internal note instead of a public reply.',
  'When you have documentation search tools, check a technical claim before making it rather than recalling it.',
].join(' ');

/** A few hops is a research question; more is a loop. */
const MAX_ROUNDS = 6;
/** Enough for a working conversation, bounded so an old tab cannot resend an essay. */
const MAX_HISTORY = 20;

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export const answer = ({ strapi }: { strapi: Core.Strapi }) => ({
  async answer(history: ChatTurn[]) {
    const turns = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content ?? '').trim())
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!turns.length) return { answer: '', toolCalls: [] };

    // Pulse's own tools stay in-process; the registry's zod schemas are already
    // the right shape, so there is nothing to translate.
    const tools: Record<string, any> = Object.fromEntries(
      PULSE_TOOLS.map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: t.input(),
          execute: async (args: any) => {
            try {
              return await t.execute(strapi, args ?? {}, { via: 'chat' });
            } catch (err: any) {
              // A failing tool is an answer ("that mention does not exist"),
              // not a dead conversation.
              return { error: err.message };
            }
          },
        }),
      ])
    );

    // ...and whatever is connected in Settings — the docs server above all,
    // which is what makes an answer about Strapi checkable rather than recalled.
    const loaded = await (strapi.service('api::analysis.mcp-tools') as any).load();
    for (const [name, mcpTool] of Object.entries(loaded.tools)) {
      if (!(name in tools)) tools[name] = mcpTool;
    }

    try {
      const { text, usage, steps } = await generateText({
        model: model(),
        system: SYSTEM,
        messages: turns,
        tools,
        stopWhen: stepCountIs(MAX_ROUNDS),
        abortSignal: AbortSignal.timeout(120_000),
      });

      const toolCalls = (steps ?? []).flatMap((s: any) =>
        (s.toolCalls ?? []).map((c: any) => ({ tool: c.toolName, input: c.input ?? c.args }))
      );
      const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
      if (tokens) await (strapi.service('api::analysis.budget') as any).add(tokens).catch(() => {});

      return {
        answer:
          text?.trim() ||
          'I hit the tool-use round limit before finishing — try a narrower question.',
        toolCalls,
        // which servers were in play, so "why did it not check the docs" is
        // answerable without reading logs — the same reason draft() reports it
        groundedBy: loaded.servers,
      };
    } finally {
      // leaks sockets otherwise, on the error path especially
      await loaded.close();
    }
  },
});

export default answer;
