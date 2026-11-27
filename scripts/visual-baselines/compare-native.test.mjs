// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): the native snapshot comparison behind 7.9-NVIS-001..008
// (Codex P1-1: compare all eight after capture, never stop at the first).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { parse } from 'yaml'
import {
  compareAll,
  compareRaw,
  findCaptureDir,
  masksFor,
  MAX_CHANGED_RATIO,
  NATIVE_SCREENS,
  readMasks,
} from './compare-native.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-native-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const SIZE = { width: 20, height: 10 }
/** A solid PNG, with `changed` pixels of the first row painted red. */
async function png(file, { changed = 0, width = SIZE.width } = {}) {
  const data = Buffer.alloc(width * SIZE.height * 4, 200)
  for (let pixel = 0; pixel < changed; pixel += 1) data.set([255, 0, 0, 255], pixel * 4)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await sharp(data, { raw: { width, height: SIZE.height, channels: 4 } })
    .png()
    .toFile(file)
}

test('[7.9-NVIS-U11] antialiasing noise is no change; a changed pixel counts', () => {
  const base = Buffer.alloc(8, 100)
  const noisy = Buffer.from([110, 90, 116, 100, 100, 100, 100, 100])
  assert.equal(compareRaw(base, noisy, { width: 2, height: 1 }).ratio, 0)
  const moved = Buffer.from([100, 100, 100, 100, 160, 100, 100, 100])
  assert.equal(compareRaw(base, moved, { width: 2, height: 1 }).ratio, 0.5)
})

test('[7.9-NVIS-U12] every screen is reported in one run: missing capture, missing baseline, size, pixels', async () => {
  const actualDir = path.join(tmp, 'run/actual')
  const baselineDir = path.join(tmp, 'run/baseline')
  const [same, small, big, resized, noBaseline, ...rest] = NATIVE_SCREENS
  // 200 pixels; 1 % is 2 pixels.
  await png(path.join(baselineDir, `${same}.png`))
  await png(path.join(actualDir, `${same}.png`))
  await png(path.join(baselineDir, `${small}.png`))
  await png(path.join(actualDir, `${small}.png`), { changed: 2 })
  await png(path.join(baselineDir, `${big}.png`))
  await png(path.join(actualDir, `${big}.png`), { changed: 3 })
  await png(path.join(baselineDir, `${resized}.png`))
  await png(path.join(actualDir, `${resized}.png`), { width: 22 })
  await png(path.join(actualDir, `${noBaseline}.png`))
  for (const name of rest) await png(path.join(baselineDir, `${name}.png`))

  const problems = await compareAll({ actualDir, baselineDir })
  assert.equal(MAX_CHANGED_RATIO, 0.01)
  assert.deepEqual(
    problems.map((problem) => problem.split(':')[0]),
    [big, resized, noBaseline, ...rest]
  )
  assert.match(problems[0], /1\.50% of pixels changed/)
  assert.ok(fs.existsSync(path.join(actualDir, `${big}-diff.png`)), 'diff written')
  assert.equal(fs.existsSync(path.join(actualDir, `${small}-diff.png`)), false)
  assert.match(problems[1], /size 22x10, baseline 20x10/)
  assert.match(problems[2], /no baseline/)
  for (const problem of problems.slice(3)) assert.match(problem, /not captured/)
})

test('[7.9-NVIS-U13] the flow only captures, and the visual row compares after it', () => {
  const tab = fs.readFileSync(
    path.join(root, 'maestro/subflows/shell-visual-tab.yaml'),
    'utf8'
  )
  assert.equal(tab.includes('assertScreenshot'), false, 'no compare inside the flow')
  assert.match(
    tab,
    /takeScreenshot:\n\s+path: maestro\/artifacts\/shell-visual\/\$\{SCHEME\}-\$\{NAME\}/
  )

  const workflow = parse(
    fs.readFileSync(path.join(root, '.github/workflows/pr-mobile-e2e.yml'), 'utf8')
  )
  const steps = workflow.jobs['mobile-e2e-android'].steps
  const names = steps.map((step) => step.name)
  const compare = steps.find((step) => step.name === 'Compare native shell snapshots')
  assert.ok(compare, 'compare step present')
  assert.equal(compare.run, 'node scripts/visual-baselines/compare-native.mjs')
  assert.match(compare.if, /!cancelled\(\)/)
  assert.match(compare.if, /matrix\.lane == 'visual'/)
  assert.ok(
    names.indexOf('Run Maestro suite') < names.indexOf('Compare native shell snapshots')
  )
  assert.ok(
    names.indexOf('Compare native shell snapshots') <
      names.indexOf('Check Maestro artifacts for secret values'),
    'diffs exist before the artifact scan and upload'
  )
})

test('[7.9-NVIS-U14b] masked rectangles are ignored, only for their own tab, and every mask names its reason', () => {
  const base = Buffer.alloc(4 * 4 * 4, 100)
  const actual = Buffer.from(base)
  actual.set([255, 0, 0, 255], (1 * 4 + 1) * 4) // pixel (1, 1) moved
  assert.equal(compareRaw(base, actual, { width: 4, height: 4 }).ratio, 1 / 16)
  assert.equal(compareRaw(base, actual, { width: 4, height: 4 }, [[1, 1, 1, 1]]).ratio, 0)
  assert.equal(
    compareRaw(base, actual, { width: 4, height: 4 }, [[2, 2, 2, 2]]).ratio,
    1 / 16
  )

  const masks = readMasks(path.join(root, 'maestro/snapshots/shell-visual'))
  assert.deepEqual(Object.keys(masks).sort(), [
    'community',
    'home',
    'looks',
    'profile',
    'wardrobe',
  ])
  assert.deepEqual(masksFor('dark-profile', masks), masksFor('light-profile', masks))
  // Every tab hides only the scroll indicator strip in the right gutter; generated text adds more.
  const strip = [704, 160, 16, 960]
  // Story CC-7.11 D16: the hourly ribbon left Today's first screen (its label mask went with it)
  // and the live comfort note took its place.
  assert.equal(masksFor('light-home', masks).length, 2)
  assert.deepEqual(masksFor('light-home', masks).at(-1), strip)
  assert.deepEqual(masksFor('dark-wardrobe', masks), [strip])
  assert.equal(masksFor('light-profile', masks).length, 2)
  assert.equal(masksFor('light-community', masks).length, 2)
  // Story CC-7.12 (Step 69): the seeded capsule's "Saved <date>" line changes every day.
  assert.deepEqual(masksFor('dark-looks', masks), [[40, 814, 220, 36], strip])
  for (const entries of Object.values(masks))
    for (const { rect, reason } of entries) {
      assert.equal(rect.length, 4)
      assert.ok(
        rect[2] * rect[3] <= 720 * 1280 * 0.1,
        'a mask covers at most a tenth of the screen'
      )
      assert.ok(reason.length > 10, 'every mask says why')
    }
})

test('[7.9-NVIS-U15] the compare finds the captures under Maestro debug output, newest run first', () => {
  const artifacts = path.join(tmp, 'artifacts')
  const capture = (run) =>
    path.join(
      artifacts,
      run,
      'CC-7.9 shell snapshots in light and dark on the smallest phone',
      'takeScreenshot/maestro/artifacts/shell-visual'
    )
  assert.equal(findCaptureDir(path.join(tmp, 'missing')), null)
  fs.mkdirSync(path.join(artifacts, 'android-flows/snapshots/shell-visual'), {
    recursive: true,
  })
  assert.equal(findCaptureDir(artifacts), null, 'the bundled baselines are no capture')
  fs.mkdirSync(capture('2026-11-26_072614'), { recursive: true })
  fs.mkdirSync(capture('2026-11-26_081500'), { recursive: true })
  const later = new Date(Date.now() + 60_000)
  fs.utimesSync(capture('2026-11-26_081500'), later, later)
  assert.equal(findCaptureDir(artifacts), capture('2026-11-26_081500'))
})
