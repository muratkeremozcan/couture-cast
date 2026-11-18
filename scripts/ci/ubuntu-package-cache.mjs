// The cache key and directory for the Ubuntu package files that a browser step downloads:
// browser-acceptance's (share-card-browser-deps.mjs) and the WebKit packages of
// .github/actions/setup-playwright-browsers. Playwright pins the package list for each of its
// versions, Ubuntu release and engine, so the key names those and the runner. A workflow restores
// only this exact key: a key that matched by prefix could hand over the files of another package
// list. The key also names the ISO week, so a fresh cache starts every week: Ubuntu's updates
// replace package versions inside one package list, apt-install.sh drops each restored file the
// index no longer lists, and a cache saved once would otherwise download more every run.
//
//   node scripts/ci/ubuntu-package-cache.mjs [--chromium-only] >> "$GITHUB_OUTPUT"
//   node scripts/ci/ubuntu-package-cache.mjs --playwright webkit >> "$GITHUB_OUTPUT"
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { shareCardBrowserEngines } from './share-card-browser-deps.mjs'

const ENGINE_SETS = ['chromium', 'webkit', 'chromium,firefox,webkit']
const required = () => new Error('ubuntu_package_cache_key_input_required')

function releaseField(osRelease, name) {
  const match = new RegExp(`^${name}=(?:"([^"\\n]*)"|([^\\s"]*))\\s*$`, 'm').exec(
    String(osRelease ?? '')
  )
  return match?.[1] ?? match?.[2] ?? ''
}

/** The ISO 8601 week of a date in UTC, such as 2026-W47. */
export function isoWeek(date) {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  )
  // The week belongs to the year of its Thursday.
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7))
  const firstDay = Date.UTC(day.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((day.getTime() - firstDay) / 86400000 + 1) / 7)
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function packageCacheKey({
  runnerOs,
  runnerArch,
  osRelease,
  playwrightVersion,
  browsers,
  week,
}) {
  const id = releaseField(osRelease, 'ID')
  const version = releaseField(osRelease, 'VERSION_ID')
  const words = [runnerOs, runnerArch, id, version]
  if (
    !words.every((word) => /^[A-Za-z0-9.]+$/.test(String(word ?? ''))) ||
    !/^\d+\.\d+\.\d+$/.test(String(playwrightVersion ?? '')) ||
    !Array.isArray(browsers) ||
    !ENGINE_SETS.includes(browsers.join(',')) ||
    !/^\d{4}-W\d{2}$/.test(String(week ?? ''))
  )
    throw required()
  return [
    'ubuntu-packages-v1',
    runnerOs,
    runnerArch,
    `${id}${version}`,
    `playwright${playwrightVersion}`,
    ...browsers,
    week,
  ].join('-')
}

export function packageCacheDirectory(env) {
  if (!env.RUNNER_TEMP) throw required()
  return path.join(env.RUNNER_TEMP, 'ubuntu-packages')
}

/**
 * The engines whose packages the step installs: `--playwright <engine>...` names them as
 * apt-install.sh takes them; otherwise share-card-browser-deps.mjs's arguments pick them.
 */
export function cacheEngines(args) {
  return args[0] === '--playwright' ? args.slice(1) : shareCardBrowserEngines(args)
}

/** The step outputs: the exact key and the directory apt-install.sh keeps the files in. */
export function cacheOutputs(args, env, { osRelease, playwrightVersion, now }) {
  const key = packageCacheKey({
    runnerOs: env.RUNNER_OS,
    runnerArch: env.RUNNER_ARCH,
    osRelease,
    playwrightVersion,
    browsers: cacheEngines(args),
    week: now instanceof Date && !Number.isNaN(now.getTime()) ? isoWeek(now) : '',
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
        now: new Date(),
      })
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
