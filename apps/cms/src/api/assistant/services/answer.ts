import type { Core } from '@strapi/strapi';

import { anthropicTools, getTool } from '../../../tools/registry';

/**
 * Chat with the data — an agentic tool-use loop over the SAME tool registry the
 * MCP server exposes (src/tools/registry.ts): queue, mention detail, save-draft,
 * search, trends, themes. Callers gate on aiEnabled — a key is assumed present.
 */

const SYSTEM = [
  "You are Pulse, the Strapi team's mention-sentiment assistant, talking to a team member inside the Pulse app.",
  'Use the tools to answer from real data — never guess numbers. Be concise and concrete.',
  'When asked to draft a reply: pull the mention with pulse-get-mention, match the tone of similarPastReplies,',
  'and save with pulse-save-draft. Drafts are reviewed and posted by a human — never claim anything was posted.',
  'For competitor threads, recommend an internal note instead of a public reply.',
].join(' ');

const MAX_ROUNDS = 6;

export const answer = ({ strapi }: { strapi: Core.Strapi }) => ({
  async answer(question: string) {
    const messages: any[] = [{ role: 'user', content: question }];
    const toolCalls: { tool: string; input: unknown }[] = [];
    let totalTokens = 0;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.AI_API_KEY!,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.AI_MODEL || 'claude-sonnet-5',
            max_tokens: 1500,
            system: SYSTEM,
            tools: anthropicTools(),
            messages,
          }),
        });
        if (!res.ok) throw new Error(`anthropic ${res.status}`);
        const json: any = await res.json();
        totalTokens += (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0);

        if (json.stop_reason !== 'tool_use') {
          const text = (json.content ?? []).find((b: any) => b.type === 'text')?.text ?? '';
          return { answer: text, toolCalls };
        }

        messages.push({ role: 'assistant', content: json.content });
        const results: any[] = [];
        for (const block of (json.content ?? []).filter((b: any) => b.type === 'tool_use')) {
          const tool = getTool(block.name);
          let output: unknown;
          try {
            output = tool
              ? await tool.execute(strapi, block.input ?? {}, { via: 'chat' })
              : { error: `unknown tool ${block.name}` };
          } catch (err: any) {
            output = { error: err.message };
          }
          toolCalls.push({ tool: block.name, input: block.input });
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(output).slice(0, 20000),
          });
        }
        messages.push({ role: 'user', content: results });
      }
      return {
        answer: 'I hit the tool-use round limit before finishing — try a narrower question.',
        toolCalls,
      };
    } finally {
      if (totalTokens) await (strapi.service('api::analysis.budget') as any).add(totalTokens).catch(() => {});
    }
  },
});

export default answer;
