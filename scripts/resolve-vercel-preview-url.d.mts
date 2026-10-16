/** Poll until a deployment built from `expectedSha` is listed; resolves its canonical URL or undefined on timeout. */
export function waitForDeploymentWithSha(
  fetchDeployments: () => Promise<
    { url?: string; meta?: { githubCommitSha?: string } }[]
  >,
  expectedSha: string
): Promise<string | undefined>
