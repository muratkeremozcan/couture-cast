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
 * Usage: npm run visual:pull-baselines -- --web <run-id> [--native <run-id>]
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

/**
 * Copies every captured snapshot found under `downloaded` into `targetDir`, named by `nameOf`,
 * from folders called `folder`. Returns the baselines written.
 */
export function placeBaselines({ downloaded, folder, targetDir, nameOf }) {
  const written = []
  for (const file of filesUnder(downloaded)) {
    if (path.basename(path.dirname(file)) !== folder) continue
    const name = nameOf(path.basename(file))
    if (!name) continue
    fs.mkdirSync(targetDir, { recursive: true })
    fs.copyFileSync(file, path.join(targetDir, name))
    written.push(path.join(targetDir, name))
  }
  return [...new Set(written)].sort()
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const web = readArg('web')
  const native = readArg('native')
  if (!web && !native) {
    console.error(
      'Usage: npm run visual:pull-baselines -- --web <run-id> [--native <run-id>]'
    )
    process.exit(2)
  }
  const written = []
  if (web)
    written.push(
      ...placeBaselines({
        downloaded: download(web, 'blob-report-*'),
        folder: 'visual-actuals',
        targetDir: path.join(root, WEB_SNAPSHOT_DIR),
        nameOf: webBaselineName,
      })
    )
  if (native)
    written.push(
      ...placeBaselines({
        downloaded: download(
          native,
          `android-test-results-shard-${VISUAL_SHARD}-attempt-*`
        ),
        folder: 'shell-visual',
        targetDir: path.join(root, NATIVE_SNAPSHOT_DIR),
        nameOf: nativeBaselineName,
      })
    )
  if (written.length === 0) {
    console.error(
      'No captured snapshots in those runs: nothing changed, or the run was not a visual one.'
    )
    process.exit(1)
  }
  for (const file of written) console.log(path.relative(root, file))
}
