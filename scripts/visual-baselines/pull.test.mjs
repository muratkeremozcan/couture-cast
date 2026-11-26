// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner (TEA): the path from a CI run's captured screens to the committed
// baselines of 7.9-VIS and 7.9-NVIS.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  missingBaselines,
  NATIVE_BASELINES,
  NATIVE_CAPTURE_FOLDER,
  nativeBaselineName,
  placeBaselines,
  planBaselines,
  VISUAL_SHARD,
  WEB_BASELINES,
  webBaselineName,
} from './pull.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-pull-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('[7.9-VIS-U01] Playwright actuals map to the Linux Chromium baseline names', () => {
  assert.equal(webBaselineName('home-dark-actual.png'), 'home-dark-chromium-linux.png')
  assert.equal(webBaselineName('home-dark-diff.png'), null)
  assert.equal(webBaselineName('test-failed-1.png'), null)
  assert.equal(nativeBaselineName('dark-community.png'), 'dark-community.png')
  assert.equal(nativeBaselineName('chip-navigation-bottom-nav.png'), null)
})

test('[7.9-VIS-U02] only files in the named folder are planned, across shard folders', () => {
  const downloaded = path.join(tmp, 'download')
  for (const [dir, name] of [
    ['blob-report-1/visual-actuals', 'home-light-actual.png'],
    ['blob-report-2/visual-actuals', 'profile-dark-actual.png'],
    ['blob-report-2/trace', 'home-light-actual.png'],
  ]) {
    fs.mkdirSync(path.join(downloaded, dir), { recursive: true })
    fs.writeFileSync(path.join(downloaded, dir, name), dir)
  }
  const plan = planBaselines({
    downloaded,
    folder: 'visual-actuals',
    nameOf: webBaselineName,
  })
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ['home-light-chromium-linux.png', 'profile-dark-chromium-linux.png']
  )
  const targetDir = path.join(tmp, 'snapshots')
  placeBaselines(plan, targetDir)
  assert.equal(
    fs.readFileSync(path.join(targetDir, 'home-light-chromium-linux.png'), 'utf8'),
    'blob-report-1/visual-actuals'
  )
})

test('[7.9-VIS-U02b] native captures come from Maestro debug output, never the bundled baselines', () => {
  const downloaded = path.join(tmp, 'download-native')
  const capture =
    'android-test-results-shard-11-attempt-1/2026-11-26_072614/flow/takeScreenshot/maestro/artifacts/shell-visual'
  const bundled =
    'android-test-results-shard-11-attempt-1/android-flows/snapshots/shell-visual'
  for (const dir of [bundled, capture]) {
    fs.mkdirSync(path.join(downloaded, dir), { recursive: true })
    fs.writeFileSync(path.join(downloaded, dir, 'dark-home.png'), dir)
  }
  const plan = planBaselines({
    downloaded,
    folder: NATIVE_CAPTURE_FOLDER,
    nameOf: nativeBaselineName,
  })
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ['dark-home.png']
  )
  assert.equal(fs.readFileSync(plan[0].source, 'utf8'), capture)
})

test('[7.9-VIS-U04] a short set is reported by name (Codex P1-1): ten per platform (five tabs, Story CC-7.11)', () => {
  assert.equal(WEB_BASELINES.length, 10)
  assert.equal(NATIVE_BASELINES.length, 10)
  const plan = NATIVE_BASELINES.slice(0, 3).map((name) => ({ name, source: name }))
  assert.deepEqual(missingBaselines(plan, NATIVE_BASELINES), NATIVE_BASELINES.slice(3))
  assert.deepEqual(missingBaselines(plan, []), [])
  // The names match what the specs and the flow produce.
  const spec = fs.readFileSync(
    path.join(root, 'playwright/tests/app-shell-visual-snapshots.spec.ts'),
    'utf8'
  )
  for (const name of WEB_BASELINES)
    assert.match(spec, new RegExp(`'${name.replace('-chromium-linux.png', '')}'`), name)
  const tabs = fs.readFileSync(
    path.join(root, 'maestro/subflows/shell-visual-tabs.yaml'),
    'utf8'
  )
  for (const tab of ['home', 'wardrobe', 'looks', 'community', 'profile'])
    assert.match(tabs, new RegExp(`NAME: '${tab}'`), tab)
})

test('[7.9-VIS-U03] the workflows export what the script reads', () => {
  const web = parse(
    fs.readFileSync(path.join(root, '.github/workflows/pr-pw-e2e-local.yml'), 'utf8')
  )
  const copy = web.jobs['pw-e2e'].steps.find(
    (step) => step.name === 'Copy visual snapshot actuals to blob-report'
  )
  assert.ok(copy, 'pw-e2e copies the visual actuals into the uploaded blob report')
  assert.equal(copy.if, 'always()')
  assert.match(copy.run, /blob-report\/visual-actuals/)
  assert.match(copy.run, /-actual\.png/)

  const mobile = parse(
    fs.readFileSync(path.join(root, '.github/workflows/pr-mobile-e2e.yml'), 'utf8')
  )
  const rows = mobile.jobs['mobile-e2e-android'].strategy.matrix.include
  assert.equal(rows.find((row) => row.lane === 'visual')?.shard, VISUAL_SHARD)
  const flow = fs.readFileSync(
    path.join(root, 'maestro/subflows/shell-visual-tab.yaml'),
    'utf8'
  )
  assert.match(flow, /path: maestro\/artifacts\/shell-visual\/\$\{SCHEME\}-\$\{NAME\}/)
})
