// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkResults,
  EXPECTED_TESTS,
  NEED_OS_REPORT,
} from '../../../scripts/ci/check-accessibility-focus-results.mjs'

const repo = path.resolve(__dirname, '../../..')
const OS_REPORT = 'java.lang.AssertionError: the OS reported focus on the view'

type Outcome = { name: string; failure?: string }

function junit(outcomes: Outcome[]) {
  const cases = outcomes
    .map(({ name, failure }) =>
      failure === undefined
        ? `  <testcase name="${name}" classname="T" time="1" />`
        : `  <testcase name="${name}" classname="T" time="1">\n    <failure>${failure}\nat T</failure>\n  </testcase>`
    )
    .join('\n')
  return `<?xml version='1.0' encoding='UTF-8' ?>\n<testsuite name="T" tests="${outcomes.length}">\n${cases}\n</testsuite>\n`
}

const allPass = () => EXPECTED_TESTS.map((name) => ({ name }))
const controlFails = (failure = OS_REPORT) =>
  EXPECTED_TESTS.map((name) =>
    NEED_OS_REPORT.includes(name) ? { name, failure } : { name }
  )

describe('TalkBack lane results', () => {
  let results: string
  beforeEach(() => {
    results = fs.mkdtempSync(path.join(os.tmpdir(), 'talkback-results-'))
  })
  afterEach(() => fs.rmSync(results, { recursive: true, force: true }))

  function write(run: 'positive' | 'suppressed', outcomes: Outcome[] | null) {
    // AGP writes them one level down, per variant.
    fs.mkdirSync(path.join(results, run, 'debug'), { recursive: true })
    if (outcomes)
      fs.writeFileSync(
        path.join(results, run, 'debug', 'TEST-device.xml'),
        junit(outcomes)
      )
  }

  it('passes when every test passes and the control fails exactly the OS-report tests', () => {
    write('positive', allPass())
    write('suppressed', controlFails())
    expect(checkResults(results, 0, 1)).toEqual([])
  })

  it('fails a control that failed to build or install', () => {
    write('positive', allPass())
    write('suppressed', null)
    expect(checkResults(results, 0, 1)).toEqual([
      'the suppressed-focus control left no results (build or install failure)',
    ])
  })

  it('fails a control where an OS-report test passed', () => {
    write('positive', allPass())
    write(
      'suppressed',
      controlFails().map((outcome) =>
        outcome.name === NEED_OS_REPORT[0] ? { name: outcome.name } : outcome
      )
    )
    expect(checkResults(results, 0, 1)).toEqual([
      `the suppressed-focus control: ${NEED_OS_REPORT[0]} ended passed; it must fail on "java.lang.AssertionError: the OS reported focus"`,
    ])
  })

  it('fails a control whose failures are some other assertion', () => {
    write('positive', allPass())
    write(
      'suppressed',
      controlFails('java.lang.AssertionError: the focus action was taken')
    )
    expect(checkResults(results, 0, 1)).toHaveLength(NEED_OS_REPORT.length)
  })

  it('fails a control where a test that needs no report failed', () => {
    write('positive', allPass())
    write(
      'suppressed',
      EXPECTED_TESTS.map((name) => ({ name, failure: OS_REPORT }))
    )
    expect(checkResults(results, 0, 1)).toEqual([
      'the suppressed-focus control: belowApi29ItInstallsNothingAndReportsNothing failure; it must pass',
    ])
  })

  it('fails a TalkBack run that skipped or lost a test, or exited non-zero', () => {
    write('positive', allPass().slice(1))
    write('suppressed', controlFails())
    expect(checkResults(results, 1, 1)).toEqual([
      'the TalkBack run exited 1; it must pass',
      `the TalkBack run ran ${EXPECTED_TESTS.slice(1).join(', ')}; expected ${EXPECTED_TESTS.join(', ')}`,
    ])
  })
})

describe('TalkBack lane runner', () => {
  let work: string
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'talkback-runner-'))
    const android = path.join(work, 'apps/mobile/android')
    fs.mkdirSync(android, { recursive: true })
    // A gradlew that writes the scenario's JUnit XML where AGP does.
    fs.writeFileSync(
      path.join(android, 'gradlew'),
      `#!/usr/bin/env bash
echo "gradle $*" >> "$FAKE_RESULTS/calls.log"
case "$*" in *assembleDebugAndroidTest*) exit 0 ;; esac
out=../modules/accessibility-focus/android/build/outputs/androidTest-results/connected/debug
run=positive
for arg in "$@"; do case "$arg" in *suppressFocus=true) run=suppressed ;; esac; done
source="$FAKE_RESULTS/$run.xml"
if [ -f "$source" ]; then mkdir -p "$out"; cp "$source" "$out/TEST-device.xml"; fi
exit "$(cat "$FAKE_RESULTS/$run.status")"
`,
      { mode: 0o755 }
    )
    // An adb with TalkBack's touch-exploration setting following enable and disable, and
    // accessibility tracking the Settings backdrop once it starts, unless no-app-window is set.
    fs.writeFileSync(
      path.join(work, 'adb'),
      `#!/usr/bin/env bash
echo "adb $*" >> "$FAKE_RESULTS/calls.log"
state="$FAKE_RESULTS/touch"
case "$*" in
  *getprop*) echo x86_64 ;;
  *"settings put secure enabled_accessibility_services"*) echo 1 > "$state" ;;
  *"settings delete secure enabled_accessibility_services"*) echo 0 > "$state" ;;
  *"settings get secure touch_exploration_enabled"*) cat "$state" 2>/dev/null || echo 0 ;;
  *"am start -W -a android.settings.SETTINGS"*)
    [ -f "$FAKE_RESULTS/no-app-window" ] || touch "$FAKE_RESULTS/backdrop" ;;
  *"dumpsys accessibility"*)
    if [ -f "$FAKE_RESULTS/backdrop" ]; then
      echo 'A11yWindow[AccessibilityWindowInfo[title=Settings, id=12, type=TYPE_APPLICATION, focused=true, active=true]]'
    else
      echo 'A11yWindow[AccessibilityWindowInfo[title=null, id=8, type=TYPE_SYSTEM, focused=false, active=false]]'
    fi ;;
esac
exit 0
`,
      { mode: 0o755 }
    )
    fs.mkdirSync(path.join(work, 'fake'))
  })
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }))

  function scenario(
    run: 'positive' | 'suppressed',
    status: number,
    outcomes: Outcome[] | null
  ) {
    fs.writeFileSync(path.join(work, 'fake', `${run}.status`), String(status))
    if (outcomes) fs.writeFileSync(path.join(work, 'fake', `${run}.xml`), junit(outcomes))
  }

  const runLane = () =>
    spawnSync(
      'bash',
      [path.join(repo, 'scripts/ci/accessibility-focus-device-tests.sh')],
      {
        cwd: work,
        env: {
          ...process.env,
          ADB: path.join(work, 'adb'),
          FAKE_RESULTS: path.join(work, 'fake'),
          ACCESSIBILITY_FOCUS_WINDOW_WAIT: '1',
        },
        encoding: 'utf8',
      }
    )

  const calls = () =>
    fs.readFileSync(path.join(work, 'fake', 'calls.log'), 'utf8').split('\n')

  it('passes a lane whose control fails on the OS focus report', () => {
    scenario('positive', 0, allPass())
    scenario('suppressed', 1, controlFails())
    const lane = runLane()
    expect(lane.stdout).toContain('Suppressed-focus control: the 4 tests')
    expect(lane.status).toBe(0)
  })

  // Run 41238053357: a test activity closing onto the launcher left every app window
  // hidden from accessibility, so TalkBack focused none of the later test windows.
  it('runs the tests over the Settings backdrop, after TalkBack is on', () => {
    scenario('positive', 0, allPass())
    scenario('suppressed', 1, controlFails())
    expect(runLane().status).toBe(0)
    const log = calls()
    const at = (pattern: RegExp) => log.findIndex((line) => pattern.test(line))
    const talkBack = at(/settings put secure enabled_accessibility_services/)
    const backdrop = at(/am start -W -a android\.settings\.SETTINGS/)
    const firstRun = at(/connectedDebugAndroidTest/)
    expect(at(/assembleDebugAndroidTest/)).toBeLessThan(talkBack)
    expect(talkBack).toBeLessThan(backdrop)
    expect(backdrop).toBeLessThan(firstRun)
  })

  it('fails before any run when accessibility tracks no app window', () => {
    fs.writeFileSync(path.join(work, 'fake', 'no-app-window'), '')
    scenario('positive', 0, allPass())
    scenario('suppressed', 1, controlFails())
    const lane = runLane()
    expect(lane.stderr).toContain(
      '::error::accessibility tracks no active app window under the Settings backdrop'
    )
    expect(lane.status).toBe(1)
    expect(calls().some((line) => line.includes('connectedDebugAndroidTest'))).toBe(false)
    expect(lane.stdout).toContain('TalkBack off.')
  })

  it('fails a lane whose control never ran, even with an old control result on disk', () => {
    // A correct control result from an earlier run must not stand in for this one.
    const stale = path.join(
      work,
      'apps/mobile/modules/accessibility-focus/android/build/outputs/androidTest-results/connected/debug'
    )
    fs.mkdirSync(stale, { recursive: true })
    fs.writeFileSync(path.join(stale, 'TEST-earlier.xml'), junit(controlFails()))
    scenario('positive', 0, allPass())
    scenario('suppressed', 1, null)
    const lane = runLane()
    expect(lane.stdout).toContain(
      '::error::the suppressed-focus control left no results (build or install failure)'
    )
    expect(lane.status).toBe(1)
  })
})
