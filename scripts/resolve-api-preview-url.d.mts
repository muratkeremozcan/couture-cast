/**
 * Type declarations for `resolve-api-preview-url.mjs`, so its unit tests under
 * `playwright/` can import it plainly.
 */

/** List deployments, polling while `expectedSha` has none yet and `poll` is set. */
export function listDeploymentsAwaitingSha(
  listDeployments: () => Promise<
    { url?: string; meta?: { githubCommitSha?: string; githubCommitRef?: string } }[]
  >,
  expectedSha: string | undefined,
  poll: boolean,
  branch?: string
): Promise<
  { url?: string; meta?: { githubCommitSha?: string; githubCommitRef?: string } }[]
>
