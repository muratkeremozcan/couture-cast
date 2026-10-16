/**
 * Type declarations for `resolve-api-preview-url.mjs`, so its unit tests under
 * `playwright/` can import it plainly.
 */

/** List deployments, polling while `expectedSha` has none yet and `poll` is set. */
export function listDeploymentsAwaitingSha(
  listDeployments: () => Promise<{ url?: string; meta?: { githubCommitSha?: string } }[]>,
  expectedSha: string | undefined,
  poll: boolean
): Promise<{ url?: string; meta?: { githubCommitSha?: string } }[]>
