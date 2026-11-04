/**
 * Git-branch alias helpers shared by the web and API preview resolvers.
 *
 * Why this file exists:
 * - A DNS label holds at most 63 characters. Vercel builds the branch alias as
 *   `<project>-git-<branch>-<team>`; when that is longer it shortens the branch part and adds a
 *   six-character hash (`couture-cast-api-git-feat-cc-6-b6bedf-<team>`). The hash is not derivable
 *   from the branch name, so a long branch's alias can only be read back from Vercel.
 * - The deployment list omits `alias`, so the alias comes from `/v2/deployments/<id>/aliases`.
 */

/** The longest DNS label a hostname may carry. */
export const DNS_LABEL_MAX = 63

/**
 * The deterministic branch alias URL, or undefined when Vercel would shorten it.
 * @param {string | undefined} projectSlug
 * @param {string | undefined} branchSlug
 * @param {string | undefined} teamSlug
 * @returns {string | undefined}
 */
export function deterministicBranchAliasUrl(projectSlug, branchSlug, teamSlug) {
  if (!projectSlug || !branchSlug || !teamSlug) return undefined
  const label = `${projectSlug}-git-${branchSlug}-${teamSlug}`
  return label.length > DNS_LABEL_MAX ? undefined : `https://${label}.vercel.app`
}

/**
 * The git-branch alias URL among a deployment's alias hostnames.
 * @param {unknown} aliases
 * @returns {string | undefined}
 */
export function pickGitBranchAlias(aliases) {
  if (!Array.isArray(aliases)) return undefined
  const host = aliases.find(
    (alias) => typeof alias === 'string' && alias.includes('-git-')
  )
  if (!host) return undefined
  return /^https?:\/\//i.test(host) ? host : `https://${host}`
}

/**
 * A deployment's git-branch alias URL: from its own `alias` list when it has one, else from Vercel.
 * @param {Record<string, any>} deployment
 * @param {(deploymentId: string) => Promise<string[]>} fetchAliases
 * @returns {Promise<string | undefined>}
 */
export async function gitBranchAliasForDeployment(deployment, fetchAliases) {
  const own = pickGitBranchAlias(deployment?.alias)
  if (own) return own
  const id = deployment?.uid ?? deployment?.id
  if (typeof id !== 'string') return undefined
  return pickGitBranchAlias(await fetchAliases(id))
}
