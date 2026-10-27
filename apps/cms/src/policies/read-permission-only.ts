/**
 * A route that must exist but must never answer.
 *
 * Strapi only honours a content-API permission whose action is bound to a
 * route ("Only actions bound to a content-API route are returned" — core
 * content-api permissions). Since 5.52 the response sanitizer drops any
 * populated relation whose target the caller cannot `find`, so a mention's
 * person and comments vanished: `api::person.person.find` and
 * `api::comment.comment.find` were granted but had no route, so they were
 * ignored. Binding them to routes guarded by this policy registers the actions
 * without exposing a listing endpoint: a direct call gets 403.
 */
export default () => false
