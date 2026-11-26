#!/usr/bin/env node
/**
 * Story CC-7.9 (TEA): copies the screens a CI run captured into the committed visual baselines,
 * for review in the diff and commit.
 *
 * Baselines come from CI only. Web snapshots are Linux Chromium (`*-chromium-linux.png`) and the
 * native ones are the Android small_phone of the visual shard; neither matches a laptop. A new or
 * changed screen fails its run and leaves the PNG in that run's artifacts:
 *
 * - web: `blob-report-<n>` artifacts of `Playwright e2e` (pr-pw-e2e-local.yml), folder
 *   `visual-actuals/`, one `<name>-actual.png` per snapshot;
 * - native: the visual shard's `android-test-results-shard-11-attempt-<n>` artifact of
 *   `Mobile E2E` (pr-mobile-e2e.yml), folder `shell-visual/`, one `<scheme>-<tab>.png` per tab.
 *
 * Usage: npm run visual:pull-baselines -- --web <run-id> [--native <run-id>] [--all]
 * `--all` requires all ten web screens (the first pull); native always requires all ten.
 * Review every changed PNG before committing it: a baseline is the expected screen.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const WEB_SNAPSHOT_DIR =
  'playwright/tests/app-shell-visual-snapshots.spec.ts-snapshots'
export const NATIVE_SNAPSHOT_DIR = 'maestro/snapshots/shell-visual'
/**
 * Where a native capture lands: Maestro writes the flow's relative takeScreenshot path under its
 * debug output (maestro/artifacts/<run>/<flow>/takeScreenshot/), never at the repository path the
 * flow names (CI 2e5b5628: the compare read maestro/artifacts/shell-visual and found nothing).
 */
export const NATIVE_CAPTURE_FOLDER = 'takeScreenshot/maestro/artifacts/shell-visual'
export const VISUAL_SHARD = 11

/** `home-dark-actual.png` (Playwright's actual) to `home-dark-chromium-linux.png`. */
export function webBaselineName(actualName) {
  const match = /^(.+)-actual\.png$/.exec(actualName)
  return match ? `${match[1]}-chromium-linux.png` : null
}

/** `dark-home.png` from the flow's takeScreenshot; anything else is not a snapshot. */
export function nativeBaselineName(name) {
  return /^(light|dark)-[a-z]+\.png$/.test(name) ? name : null
}

const filesUnder = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    : []

/** Every web baseline the snapshot spec takes (7.9-VIS-001..008, Story CC-7.11 Looks). */
export const WEB_BASELINES = ['light', 'dark'].flatMap((scheme) =>
  ['home', 'closet', 'looks', 'community', 'profile'].map(
    (tab) => `${tab}-${scheme}-chromium-linux.png`
  )
)
/** Every native capture of the visual flow (7.9-NVIS-001..008, Story CC-7.11 Looks). */
export const NATIVE_BASELINES = ['light', 'dark'].flatMap((scheme) =>
  ['home', 'wardrobe', 'looks', 'community', 'profile'].map(
    (tab) => `${scheme}-${tab}.png`
  )
)

/**
 * The copies to make: every captured snapshot under `downloaded`, from folders called `folder`,
 * named by `nameOf`, as `{ source, name }` sorted by name (one source per name).
 */
export function planBaselines({ downloaded, folder, nameOf }) {
  const byName = new Map()
  for (const file of filesUnder(downloaded)) {
    // `folder` may name several trailing segments: the native captures sit under Maestro's
    // debug output, beside the bundled copy of the committed baselines (snapshots/shell-visual).
    const dir = path.dirname(file).split(path.sep).join('/')
    if (dir !== folder && !dir.endsWith(`/${folder}`)) continue
    const name = nameOf(path.basename(file))
    if (name && !byName.has(name)) byName.set(name, file)
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, source]) => ({ name, source }))
}

/** Names in `expected` the plan does not cover. */
export const missingBaselines = (plan, expected) =>
  expected.filter((name) => !plan.some((entry) => entry.name === name))

/** Copies a plan into `targetDir`; returns the files written. */
export function placeBaselines(plan, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  return plan.map(({ name, source }) => {
    fs.copyFileSync(source, path.join(targetDir, name))
    return path.join(targetDir, name)
  })
}

const download = (runId, pattern) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-baselines-'))
  const result = spawnSync(
    'gh',
    ['run', 'download', runId, '--pattern', pattern, '--dir', dir],
    {
      stdio: 'inherit',
    }
  )
  if (result.status !== 0)
    throw new Error(`gh run download ${runId} --pattern ${pattern} failed`)
  return dir
}

const readArg = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

// A symlinked checkout still runs this file directly (scripts/direct-run-guard.test.mjs).
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const web = readArg('web')
  const native = readArg('native')
  // --all: the first pull, when every web screen is new and must be present. A later web run
  // fails only the screens that changed, so its pull is partial by nature.
  const all = process.argv.includes('--all')
  if (!web && !native) {
    console.error(
      'Usage: npm run visual:pull-baselines -- --web <run-id> [--native <run-id>] [--all]'
    )
    process.exit(2)
  }
  const jobs = []
  if (web)
    jobs.push({
      label: 'web',
      plan: planBaselines({
        downloaded: download(web, 'blob-report-*'),
        folder: 'visual-actuals',
        nameOf: webBaselineName,
      }),
      targetDir: path.join(root, WEB_SNAPSHOT_DIR),
      expected: all ? WEB_BASELINES : [],
    })
  if (native)
    jobs.push({
      label: 'native',
      plan: planBaselines({
        downloaded: download(
          native,
          `android-test-results-shard-${VISUAL_SHARD}-attempt-*`
        ),
        folder: NATIVE_CAPTURE_FOLDER,
        nameOf: nativeBaselineName,
      }),
      targetDir: path.join(root, NATIVE_SNAPSHOT_DIR),
      // The flow captures every screen on every run: a short set means it stopped early.
      expected: NATIVE_BASELINES,
    })
  // Nothing is copied unless every job is complete, so a partial set never lands.
  const gaps = jobs.flatMap(({ label, plan, expected }) =>
    missingBaselines(plan, expected).map((name) => `${label}: ${name}`)
  )
  if (gaps.length) {
    console.error(`Missing captures, nothing copied:\n  ${gaps.join('\n  ')}`)
    process.exit(1)
  }
  const written = jobs.flatMap(({ plan, targetDir }) => placeBaselines(plan, targetDir))
  if (written.length === 0) {
    console.error(
      'No captured snapshots in those runs: nothing changed, or the run was not a visual one.'
    )
    process.exit(1)
  }
  for (const file of written) console.log(path.relative(root, file))
}
