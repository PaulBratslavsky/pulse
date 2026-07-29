/** Tool gates are per-tool admin permission actions — see src/tools/registry.ts
 *  (toolAction) and registerMcpToolPermissions in ./index.ts. Policies are OR:
 *  the session gate passes when the token's ability satisfies ANY listed policy. */
/**
 * MCP clients reject a result over ~1 MB with an opaque "Tool result is too
 * large" the agent can't act on. The payload rides the wire TWICE (content
 * text + structuredContent), so measure the DOUBLED size and return a
 * structured, actionable notice instead of blowing the limit.
 * (Pattern borrowed from the music-kb MCP adapter.)
 */
const MAX_WIRE_BYTES = 950_000;

export const asResult = (data: unknown, shrinkHint?: string) => {
  const bytes = Buffer.byteLength(JSON.stringify(data ?? null), 'utf8');
  const wireBytes = bytes * 2 + 2048;
  const payload =
    wireBytes > MAX_WIRE_BYTES
      ? {
          error: 'RESULT_TOO_LARGE',
          bytes: wireBytes,
          limitBytes: MAX_WIRE_BYTES,
          message: `This result is ~${(wireBytes / 1_000_000).toFixed(2)} MB on the wire (sent twice), over the ~1 MB MCP limit. ${shrinkHint ?? 'Re-issue with a smaller limit / fewer fields.'}`,
        }
      : data;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: { result: payload },
  };
};
