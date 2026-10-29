/**
 * Which MCP tools only read.
 *
 * The reply drafter and chat run with untrusted public posts in the prompt, so
 * a post can ask the model to call any tool it was given. They therefore get an
 * ALLOW-list: a tool the server marks `readOnlyHint: true`, or one whose verb
 * reads. Everything else — writes, and verbs we do not recognise — is left out.
 * A Resources server must pass the same test for every tool it exposes.
 *
 * Kept free of Strapi imports so the unit tests can load it directly.
 */

export type ToolDefinition = {
  name: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } | null
}

const READ_VERBS = new Set([
  'list', 'get', 'read', 'search', 'query', 'find', 'fetch', 'lookup', 'retrieve',
  'ask', 'describe', 'count', 'show', 'view', 'check',
])

const WRITE_VERBS = new Set([
  'create', 'update', 'delete', 'publish', 'unpublish', 'discard', 'remove', 'upload',
  'move', 'set', 'add', 'send', 'post', 'edit', 'patch', 'write', 'run', 'exec',
  'execute', 'mute', 'unmute', 'claim', 'route', 'save', 'insert', 'put', 'merge',
  'archive', 'assign', 'close', 'reply', 'approve', 'reject', 'trigger', 'import',
  'sync', 'reset', 'revoke', 'cancel', 'deploy', 'invite', 'enable', 'disable',
  'toggle', 'rescore', 'replay', 'acknowledge', 'correct', 'refine', 'draft',
])

/** `pulse-update-mention`, `list_blog-post`, `searchDocs` → their words, lowercased. */
const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())

/**
 * The FIRST verb in the name decides, so a namespace prefix (`pulse-`,
 * `kapa_`) is skipped and a noun later on (`get_blog-post`) is not read as a
 * verb. An explicit `readOnlyHint: false` or `destructiveHint: true` always
 * excludes; `readOnlyHint: true` admits a name we cannot parse.
 */
export function isReadOnlyTool(tool: ToolDefinition): boolean {
  const a = tool.annotations ?? undefined
  if (a?.readOnlyHint === false || a?.destructiveHint === true) return false
  if (a?.readOnlyHint === true) return true
  for (const w of words(tool.name)) {
    if (WRITE_VERBS.has(w)) return false
    if (READ_VERBS.has(w)) return true
  }
  return false
}

/** Names of the tools that are NOT read-only, for an error message. */
export const writableTools = (tools: ToolDefinition[]) => tools.filter((t) => !isReadOnlyTool(t)).map((t) => t.name)
