/** Poll until a deployment built from `expectedSha` is listed; resolves its canonical URL or undefined on timeout. */
export function waitForDeploymentWithSha(
  fetchDeployments: () => Promise<
    { url?: string; meta?: { githubCommitSha?: string; githubCommitRef?: string } }[]
  >,
  expectedSha: string,
  branch: string
): Promise<string | undefined>
