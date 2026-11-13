// The cache key and directory for the Ubuntu package files that browser-acceptance's browser step
// downloads. Playwright pins the package list for each of its versions, Ubuntu release and engine,
// so the key names those and the runner. The workflow restores only this exact key: a key that
// matched by prefix could hand over the files of another package list.
//
//   node scripts/ci/ubuntu-package-cache.mjs [--chromium-only] >> "$GITHUB_OUTPUT"
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { shareCardBrowserEngines } from './share-card-browser-deps.mjs'

const ENGINE_SETS = ['chromium', 'chromium,firefox,webkit']
const required = () => new Error('ubuntu_package_cache_key_input_required')

function releaseField(osRelease, name) {
  const match = new RegExp(`^${name}=(?:"([^"\\n]*)"|([^\\s"]*))\\s*$`, 'm').exec(
    String(osRelease ?? '')
  )
  return match?.[1] ?? match?.[2] ?? ''
}

export function packageCacheKey({
  runnerOs,
  runnerArch,
  osRelease,
  playwrightVersion,
  browsers,
}) {
  const id = releaseField(osRelease, 'ID')
  const version = releaseField(osRelease, 'VERSION_ID')
  const words = [runnerOs, runnerArch, id, version]
  if (
    !words.every((word) => /^[A-Za-z0-9.]+$/.test(String(word ?? ''))) ||
    !/^\d+\.\d+\.\d+$/.test(String(playwrightVersion ?? '')) ||
    !Array.isArray(browsers) ||
    !ENGINE_SETS.includes(browsers.join(','))
  )
    throw required()
  return [
    'ubuntu-packages-v1',
    runnerOs,
    runnerArch,
    `${id}${version}`,
    `playwright${playwrightVersion}`,
    ...browsers,
  ].join('-')
}

export function packageCacheDirectory(env) {
  if (!env.RUNNER_TEMP) throw required()
  return path.join(env.RUNNER_TEMP, 'ubuntu-packages')
}

/** The step outputs: the exact key and the directory apt-install.sh keeps the files in. */
export function cacheOutputs(args, env, { osRelease, playwrightVersion }) {
  const key = packageCacheKey({
    runnerOs: env.RUNNER_OS,
    runnerArch: env.RUNNER_ARCH,
    osRelease,
    playwrightVersion,
    browsers: shareCardBrowserEngines(args),
  })
  return `key=${key}\npath=${packageCacheDirectory(env)}\n`
}

if (
  process.argv[1] &&
  pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url
) {
  try {
    const read = (file) => {
      try {
        return fs.readFileSync(file, 'utf8')
      } catch {
        throw required()
      }
    }
    // The CLI that installs the packages resolves this same playwright-core.
    const playwrightVersion = createRequire(import.meta.url)(
      'playwright-core/package.json'
    ).version
    process.stdout.write(
      cacheOutputs(process.argv.slice(2), process.env, {
        osRelease: read('/etc/os-release'),
        playwrightVersion,
      })
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
