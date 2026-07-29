/** Thrown by workflow service methods on illegal transitions / bad input —
 *  controllers map status → ctx (404/409/400) and never re-implement rules. */
export class WorkflowError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Map a WorkflowError onto the Koa ctx; rethrow anything else. */
export function sendWorkflowError(ctx: any, err: unknown) {
  if (err instanceof WorkflowError) {
    if (err.status === 404) return ctx.notFound(err.message)
    if (err.status === 409) return ctx.conflict ? ctx.conflict(err.message) : ctx.throw(409, err.message)
    return ctx.badRequest(err.message)
  }
  throw err
}
