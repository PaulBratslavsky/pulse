import type { Core } from '@strapi/strapi';

/**
 * Stop spending once the day's token budget is gone.
 *
 * The sweep has respected the ceiling since it was written, because a runaway
 * background job is the failure everyone imagines. The buttons never did — and
 * they are the ones a person can hold down: draft, refine, ask-about-this-reply,
 * suggest-identity. A limit the automated path obeys and the interactive path
 * ignores is not a limit, it is a report.
 *
 * The sweep handles the same limit differently and correctly: it leaves the
 * mentions 'pending' and picks them up tomorrow, so nothing is lost by waiting.
 * A button has no such queue — the person is standing there — so it has to say
 * what happened and what still works instead of failing quietly.
 *
 * Returns true when it has already written the 429 — the caller just returns.
 */
export async function budgetSpent(
  strapi: Core.Strapi,
  ctx: any,
  resumes: string
): Promise<boolean> {
  const { spent, budget, exceeded } = await (
    strapi.service('api::analysis.budget') as any
  ).status();
  if (!exceeded) return false;

  ctx.status = 429;
  ctx.body = {
    data: null,
    error: {
      status: 429,
      // Says what is gone, how much, and what still works — the alternative is
      // a red toast that reads like the feature is broken.
      message: `Today's AI budget is spent (${spent}/${budget} tokens). ${resumes}`,
    },
  };
  return true;
}
