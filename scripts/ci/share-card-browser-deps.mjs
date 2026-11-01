import fs from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const sourceLine = /^[\t ]*(?:URIs:|deb(?:-src)?\s)/
const azureArchive = /https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu(?=[/\s]|$)/g
const runnerMirrorList = /mirror\+file:\/etc\/apt\/apt-mirrors\.txt(?=\s|$)/g
const officialArchive = /https?:\/\/archive\.ubuntu\.com\/ubuntu(?=[/\s]|$)/

/** Keep suites, components, keyrings, security sources and third-party repositories intact. */
export function officialUbuntuSource(text) {
  return text
    .split('\n')
    .map((line) =>
      sourceLine.test(line)
        ? line
            .replace(azureArchive, 'https://archive.ubuntu.com/ubuntu')
            .replace(runnerMirrorList, 'https://archive.ubuntu.com/ubuntu')
        : line
    )
    .join('\n')
}

/** Restore the runner's source files after success, installation failure or its deadline. */
export async function provisionShareCardBrowsers({
  platform,
  architecture,
  githubActions,
  osRelease,
  files,
  readSource,
  writeSource,
  install,
}) {
  if (
    platform !== 'linux' ||
    architecture !== 'x64' ||
    githubActions !== 'true' ||
    !/^ID=(?:ubuntu|"ubuntu")\s*$/m.test(osRelease)
  )
    throw new Error('owned_ubuntu_browser_runner_required')
  const plans = await Promise.all(
    files.map(async (file) => {
      const before = await readSource(file)
      return { file, before, after: officialUbuntuSource(before) }
    })
  )
  if (
    !plans.some(({ after }) =>
      after
        .split('\n')
        .some((line) => sourceLine.test(line) && officialArchive.test(line))
    )
  )
    throw new Error('official_ubuntu_archive_required')
  const touched = []
  const cleanup = []
  let failure
  try {
    for (const plan of plans) {
      if (plan.before === plan.after) continue
      touched.push(plan)
      await writeSource(plan.file, plan.after)
    }
    await install()
  } catch (error) {
    failure = error
  } finally {
    for (const plan of touched.reverse()) {
      try {
        await writeSource(plan.file, plan.before)
      } catch (error) {
        cleanup.push(error)
      }
    }
  }
  if (cleanup.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanup],
      'browser_dependency_source_restore_failed'
    )
  if (failure) throw failure
}

/**
 * Use the installed lockfile-matched Playwright CLI; OS browser versions are independent.
 *
 * A failed install gets one more attempt after a pause. While an Ubuntu archive mirror
 * is syncing it serves index files of the wrong size and apt exits with
 * "Mirror sync in progress?"; the sync settles within seconds.
 * A deadline hit is not retried, because the step's time is already spent.
 */
export function installPinnedPlaywrightBrowsers({
  run = spawnSync,
  node = process.execPath,
  cli = createRequire(import.meta.url).resolve('@playwright/test/cli'),
  browsers = ['chromium', 'firefox', 'webkit'],
  retryPauseSeconds = 45,
} = {}) {
  if (
    !Array.isArray(browsers) ||
    !['chromium', 'chromium,firefox,webkit'].includes(browsers.join(','))
  )
    throw new Error('browser_dependency_engine_selection_required')
  try {
    installOnce({ run, node, cli, browsers })
  } catch (error) {
    if (error.message !== 'browser_dependency_install_failed') throw error
    console.log(
      `Browser dependency install failed; retrying once in ${retryPauseSeconds}s in case an Ubuntu mirror sync was in progress.`
    )
    run('sleep', [String(retryPauseSeconds)], { stdio: 'inherit' })
    installOnce({ run, node, cli, browsers })
  }
}

function installOnce({ run, node, cli, browsers }) {
  const result = run(
    'timeout',
    [
      '--signal=TERM',
      '--kill-after=15s',
      '600s',
      node,
      cli,
      'install',
      '--with-deps',
      ...browsers,
    ],
    { stdio: 'inherit', timeout: 620000, killSignal: 'SIGKILL' }
  )
  if (result.error?.code === 'ENOENT')
    throw new Error('browser_dependency_deadline_required')
  if ([124, 137].includes(result.status) || result.error?.code === 'ETIMEDOUT')
    throw new Error('browser_dependency_install_timeout')
  if (result.error || result.status !== 0)
    throw new Error('browser_dependency_install_failed')
}

export function shareCardBrowserEngines(args) {
  if (!args.length) return ['chromium', 'firefox', 'webkit']
  if (args.length === 1 && args[0] === '--chromium-only') return ['chromium']
  throw new Error('browser_dependency_engine_selection_required')
}

async function main() {
  const browsers = shareCardBrowserEngines(process.argv.slice(2))
  if (
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    process.env.GITHUB_ACTIONS !== 'true'
  )
    throw new Error('owned_ubuntu_browser_runner_required')
  const apt = '/etc/apt'
  const files = []
  try {
    if ((await fs.lstat(path.join(apt, 'sources.list'))).isFile())
      files.push(path.join(apt, 'sources.list'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const entry of await fs.readdir(path.join(apt, 'sources.list.d'), {
    withFileTypes: true,
  }))
    if (entry.isFile() && /\.(sources|list)$/.test(entry.name))
      files.push(path.join(apt, 'sources.list.d', entry.name))
  await provisionShareCardBrowsers({
    platform: process.platform,
    architecture: process.arch,
    githubActions: process.env.GITHUB_ACTIONS,
    osRelease: await fs.readFile('/etc/os-release', 'utf8'),
    files,
    readSource: (file) => fs.readFile(file, 'utf8'),
    writeSource: async (file, value) => {
      const result = spawnSync('sudo', ['-n', 'tee', file], {
        input: value,
        stdio: ['pipe', 'ignore', 'pipe'],
        timeout: 10000,
      })
      if (result.error || result.status !== 0)
        throw new Error('browser_dependency_source_write_failed')
    },
    install: () => installPinnedPlaywrightBrowsers({ browsers }),
  })
  console.log(
    'Pinned browser dependencies installed within the bounded provisioning step; original APT sources restored.'
  )
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
)
  await main()
