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
  nativeBaselineName,
  placeBaselines,
  VISUAL_SHARD,
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

test('[7.9-VIS-U02] only files in the named folder are placed, across shard folders', () => {
  const downloaded = path.join(tmp, 'download')
  for (const [dir, name] of [
    ['blob-report-1/visual-actuals', 'home-light-actual.png'],
    ['blob-report-2/visual-actuals', 'profile-dark-actual.png'],
    ['blob-report-2/trace', 'home-light-actual.png'],
  ]) {
    fs.mkdirSync(path.join(downloaded, dir), { recursive: true })
    fs.writeFileSync(path.join(downloaded, dir, name), dir)
  }
  const targetDir = path.join(tmp, 'snapshots')
  const written = placeBaselines({
    downloaded,
    folder: 'visual-actuals',
    targetDir,
    nameOf: webBaselineName,
  })
  assert.deepEqual(
    written.map((file) => path.basename(file)),
    ['home-light-chromium-linux.png', 'profile-dark-chromium-linux.png']
  )
  assert.equal(
    fs.readFileSync(path.join(targetDir, 'home-light-chromium-linux.png'), 'utf8'),
    'blob-report-1/visual-actuals'
  )
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
