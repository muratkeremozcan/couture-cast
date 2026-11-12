// The Actions cache key of the local Supabase image set, for start-local-supabase and
// preload-supabase-images alike. It covers the Supabase CLI version, supabase/config.toml
// and the exclude list, so a hit holds every image the start needs. The CLI version comes
// from package-lock.json, so the key is known before the install: preload restores and
// loads the images while the dependencies install.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The supabase CLI version package-lock.json pins. */
export function cliVersionFromLock(lockText) {
  const version = JSON.parse(lockText).packages?.['node_modules/supabase']?.version
  if (!version) throw new Error('package-lock.json pins no supabase CLI')
  return version
}

/**
 * @param {{ runnerOs: string, runnerArch: string, cliVersion: string, configHash: string, exclude: string }} input
 *   configHash is GitHub's hashFiles('supabase/config.toml')
 */
export function supabaseImageCacheKey({
  runnerOs,
  runnerArch,
  cliVersion,
  configHash,
  exclude,
}) {
  if (!/^[0-9a-f]{16,}$/.test(configHash)) throw new Error('config hash required')
  const excludeHash = createHash('sha256').update(exclude).digest('hex').slice(0, 16)
  return `supabase-images-v2-${runnerOs}-${runnerArch}-cli${cliVersion}-config${configHash.slice(0, 16)}-exclude${excludeHash}`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const env = process.env
  const key = supabaseImageCacheKey({
    runnerOs: env.RUNNER_OS,
    runnerArch: env.RUNNER_ARCH,
    cliVersion: cliVersionFromLock(
      readFileSync(path.join(root, 'package-lock.json'), 'utf8')
    ),
    configHash: env.CONFIG_HASH ?? '',
    exclude: env.EXCLUDE ?? '',
  })
  appendFileSync(
    env.GITHUB_OUTPUT,
    `key=${key}\ndir=${path.join(env.RUNNER_TEMP, 'supabase-image-cache')}\n`
  )
}
