/** Type declarations for `vercel-branch-alias.mjs`, so its unit tests under `playwright/` import it plainly. */
export const DNS_LABEL_MAX: number
/** The deterministic branch alias URL, or undefined when Vercel would shorten it. */
export function deterministicBranchAliasUrl(
  projectSlug: string | undefined,
  branchSlug: string | undefined,
  teamSlug: string | undefined
): string | undefined
/** The git-branch alias URL among a deployment's alias hostnames. */
export function pickGitBranchAlias(aliases: unknown): string | undefined
/** Whether Vercel built the deployment from exactly this branch (the raw git ref). */
export function deploymentBuiltFromBranch(
  deployment: { meta?: { githubCommitRef?: string } },
  branch: string | undefined
): boolean
/** A deployment's git-branch alias URL: from its own `alias` list, else from Vercel. */
export function gitBranchAliasForDeployment(
  deployment: { uid?: string; id?: string; alias?: string[] },
  fetchAliases: (deploymentId: string) => Promise<string[]>
): Promise<string | undefined>
