/** Tool gates are per-tool admin permission actions — see src/tools/registry.ts
 *  (toolAction) and registerMcpToolPermissions in ./index.ts. Policies are OR:
 *  the session gate passes when the token's ability satisfies ANY listed policy. */
export const asResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: { result: data },
});
