// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const module = 'apps/mobile/modules/accessibility-focus/android'
const read = (file) =>
  fs.readFileSync(
    fileURLToPath(new URL(`../../${module}/${file}`, import.meta.url)),
    'utf8'
  )
const composer = read(
  'src/androidTest/java/expo/modules/accessibilityfocus/ShareCardComposerTalkBackTest.kt'
)

test('every assertion in the composer test carries a message so a failure names itself', () => {
  const bare = composer
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) =>
      /\bassert(?:True|False|Equals|NotEquals|Null|NotNull|Same)\((?!")/.test(line)
    )
  assert.deepEqual(
    bare.map(({ number, line }) => `${number}: ${line.trim()}`),
    []
  )
})

test('no non-null assertion can throw on a node that is not attached yet', () => {
  assert.doesNotMatch(composer, /!!/)
})

test('the tree is settled and the traversal order waited for before any order or label check', () => {
  const settle = composer.indexOf('settledTree("Composer tree settles")')
  const order = composer.indexOf(
    'waitFor("Traversal order title, watermark, save, cancel")'
  )
  const label = composer.indexOf('waitFor("Label of $id")')
  assert.ok(settle > 0 && settle < order && order < label)
  assert.doesNotMatch(composer, /val order = all\(\)/)
})

test('TalkBack readiness is awaited at the start of both tests, before any fixture opens', () => {
  const tests = composer.split('@Test').slice(1)
  assert.equal(tests.length, 2)
  for (const body of tests) {
    const ready = body.indexOf('awaitTalkBackReady()')
    assert.ok(ready > 0 && ready < body.indexOf('fixture('))
  }
  assert.match(composer, /waitFor\("TalkBack service must be bound"\)/)
  assert.match(composer, /waitFor\("Active window available"\)/)
})

test('focus returns and jumps use the 5 s focus bound, network-backed states keep the default wait', () => {
  for (const name of [
    'TalkBack focus on Save after saving',
    'Focused Save is in the active modal window',
    'TalkBack restored to opener',
    'Save initially focused',
    'Owned Saving without a Cancel focus jump',
    'Old save focuses its Cancel recovery control',
  ])
    assert.match(composer, new RegExp(`waitForFocus\\("${name}"\\)`), name)
  for (const name of ['Saved status', 'Approved preview', 'Committed file remains owned'])
    assert.match(composer, new RegExp(`\\bwaitFor\\("${name}"\\)`), name)
  assert.match(composer, /TreeSettling\.waitForFocus\(/)
  const helper = read(
    'src/testShared/java/expo/modules/accessibilityfocus/TreeSettling.kt'
  )
  assert.match(helper, /const val FOCUS_BOUND_MS = 5_000L/)
  assert.match(helper, /"\$message within \$\{FOCUS_BOUND_MS\} ms"/)
})

test('focus latency is recorded per wait and reported to the harness after every test', () => {
  assert.match(composer, /record = \{ focusLatencies \+= it \}/)
  assert.match(composer, /@After\s+fun reportFocusLatencies\(\)/)
  assert.match(composer, /REPORT_KEY_STREAMRESULT/)
  const helper = read(
    'src/testShared/java/expo/modules/accessibilityfocus/TreeSettling.kt'
  )
  assert.match(helper, /CC68_FOCUS_LATENCY\|\$wait\|\$elapsedMs\|/)
})

test('the waiting logic is the unit-tested helper, shared by both source sets', () => {
  assert.match(composer, /TreeSettling\.waitFor\(/)
  assert.match(composer, /TreeSettling\.settled\(/)
  const gradle = read('build.gradle')
  assert.match(gradle, /test\.java\.srcDirs \+= 'src\/testShared\/java'/)
  assert.match(gradle, /androidTest\.java\.srcDirs \+= 'src\/testShared\/java'/)
  assert.ok(
    fs.existsSync(
      new URL(
        `../../${module}/src/testShared/java/expo/modules/accessibilityfocus/TreeSettling.kt`,
        import.meta.url
      )
    )
  )
})

test('the JVM unit test proves the old snapshot fails and the waits pass on a late-attaching tree', () => {
  const unit = read('src/test/java/expo/modules/accessibilityfocus/TreeSettlingTest.kt')
  for (const name of [
    'oneShotSnapshotAfterTitleFocusFailsBecauseLaterNodesAreNotAttachedYet',
    'namedWaitAndSettledBarrierPassOnTheSameTree',
    'settledResetsWhileTheTreeChangesAndNeedsEqualSamples',
    'aTreeThatNeverSettlesFailsWithTheNamedMessage',
    'focusReturnWithinFiveSecondsPassesAndSlowerOneFailsNamingTheBound',
    'theDefaultWaitStillAllowsSlowNetworkBackedStates',
    'focusWaitsRecordTheirElapsedTimeWhetherTheyPassOrTimeOut',
  ])
    assert.match(unit, new RegExp(`fun ${name}\\(`), name)
})

test('every label the composer test compares against is en-US catalog copy', () => {
  // The test runs in en-US and matches labels by literal text, so catalog copy that changes
  // without it (finishingSave became operation-neutral in 6.9) fails only on a device.
  const catalog = JSON.parse(
    fs.readFileSync(
      fileURLToPath(
        new URL('../../apps/mobile/assets/locales/en-US.json', import.meta.url)
      ),
      'utf8'
    )
  )
  const copy = new Set()
  const collect = (value) => {
    if (typeof value === 'string') copy.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(catalog)
  const labels = [...composer.matchAll(/label\(it\)\s*\}?\s*==\s*"([^"]+)"/g)].map(
    (match) => match[1]
  )
  assert.ok(labels.includes('Finishing up') && labels.includes('Saved to photos'))
  assert.deepEqual(
    labels.filter((label) => !copy.has(label)),
    []
  )
})
