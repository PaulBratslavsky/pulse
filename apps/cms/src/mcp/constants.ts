/**
 * Auth policies for Pulse's read-only MCP tools (verified on Strapi 5.51):
 * the session gate passes when the presenting Admin Token's ability satisfies
 * ANY policy. Both the content-api and content-manager action conventions are
 * listed so either token permission mapping works.
 */
export const readPolicy = (uid: string) => ({
  policies: [
    { action: `${uid}.find` },
    { action: 'plugin::content-manager.explorer.read', subject: uid },
  ] as [{ action: string }, ...{ action: string; subject?: string }[]],
});

export const asResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: { result: data },
});
