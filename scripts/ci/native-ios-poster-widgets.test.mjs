import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { simulatorJobs, simulatorManager } from './native-ios-command-evidence.mjs'
import {
  POSTER_WIDGET_NAME,
  posterWidgetProcesses,
  stopPosterWidgets,
  verifyPosterWidgets,
} from './native-ios-poster-widgets.mjs'
import { quietServicesRecord } from './native-ios-quiesce.mjs'

// A real simulator process list and `launchctl list`, captured from a booted iOS 26.1 device
// and pruned to the poster, widget and service rows.
const fixture = (name) =>
  fs.readFileSync(
    new URL(`./fixtures/simulator-poster-widgets/${name}`, import.meta.url),
    'utf8'
  )
const PS = fixture('ps.txt')
const LIST = fixture('list.txt')
const JOBS = simulatorJobs(LIST)
const MANAGER = simulatorManager(PS, JOBS, null)

const recorder = (results = {}) => {
  const calls = []
  const execute = (operation, binary, args) => {
    calls.push({ operation, binary, args })
    return results[operation] ?? { exitCode: 0, stdout: '' }
  }
  return { calls, execute }
}

test('only runtime-shipped Poster and Widget processes of the owned simulator are selected', () => {
  const found = posterWidgetProcesses(PS, MANAGER)
  const names = new Set(found.map((row) => row.name))
  assert.ok(found.length >= 12, 'the real list holds the poster family')
  for (const wanted of [
    'PosterBoard',
    'WidgetRenderer_Default',
    'MercuryPosterExtension',
    'PhotosPosterProvider',
    'CalendarWidgetExtension',
  ])
    assert.ok(names.has(wanted), wanted)
  // Services the permission prompt, the photo picker and search use are never selected.
  for (const kept of [
    'SpringBoard',
    'tccd',
    'assistantd',
    'searchd',
    'suggestd',
    'backboardd',
    'mobileassetd',
    'MobileCal',
    'chronod',
    'launchd_sim',
  ])
    assert.ok(!names.has(kept), kept)
  assert.ok(found.every((row) => row.ppid === MANAGER))
})

test('the app under test, host processes and unrelated owners are never selected', () => {
  const app = `61001 ${MANAGER} 1.0 /Library/Developer/CoreSimulator/Devices/D/data/Containers/Bundle/Application/U/CoutureCastStory68.app/CoutureCastStory68Widget`
  const host = '61002 1 1.0 /System/Library/Wallpaper/WallpaperAerialsExtension'
  const other =
    '61003 99999 1.0 /x.simruntime/Contents/Resources/RuntimeRoot/Applications/MercuryPosterExtension'
  const pids = posterWidgetProcesses([PS, app, host, other].join('\n'), MANAGER).map(
    (row) => row.pid
  )
  for (const pid of [61001, 61002, 61003]) assert.ok(!pids.includes(pid), String(pid))
  assert.ok(!POSTER_WIDGET_NAME.test('../Poster'))
  assert.ok(!POSTER_WIDGET_NAME.test('Photos ViewService'))
})

test('PosterBoard is booted out by its listed label, then the rest is signalled once', () => {
  const { calls, execute } = recorder()
  const record = stopPosterWidgets('DEVICE', PS, JOBS, MANAGER, execute, () => 5)
  assert.deepEqual(calls[0].args, [
    'simctl',
    'spawn',
    'DEVICE',
    'launchctl',
    'bootout',
    'system/com.apple.PosterBoard',
  ])
  const [kill] = calls.slice(1)
  assert.equal(kill.binary, 'kill')
  assert.equal(kill.args[0], '-TERM')
  assert.equal(calls.length, 2, 'one bootout and one signal, no retry')
  const boardPid = posterWidgetProcesses(PS, MANAGER).find(
    (r) => r.name === 'PosterBoard'
  ).pid
  assert.ok(
    !kill.args.includes(String(boardPid)),
    'the booted-out job is not signalled again'
  )
  assert.equal(record.job.label, 'com.apple.PosterBoard')
  assert.equal(record.job.bootoutExit, 0)
  assert.equal(record.signalled.count, kill.args.length - 1)
  assert.ok(record.signalled.names.includes('WidgetRenderer_Default'))
  assert.equal(
    record.springboardPid,
    Number(
      PS.split('\n')
        .find((l) => /SpringBoard$/.test(l))
        .trim()
        .split(/\s+/)[0]
    )
  )
  assert.equal(record.stoppedAt, 5)
})

test('a refused bootout leaves the job process in the one signal and nothing is retried', () => {
  const { calls, execute } = recorder({
    'bootout-poster-board': { exitCode: 1, stdout: '' },
  })
  const record = stopPosterWidgets('DEVICE', PS, JOBS, MANAGER, execute)
  const boardPid = posterWidgetProcesses(PS, MANAGER).find(
    (r) => r.name === 'PosterBoard'
  ).pid
  assert.ok(calls.at(-1).args.includes(String(boardPid)))
  assert.equal(record.job.bootoutExit, 1)
  assert.equal(calls.length, 2)
})

test('verification records what returned, waits out the minute and never signals again', async () => {
  const stopped = stopPosterWidgets(
    'DEVICE',
    PS,
    JOBS,
    MANAGER,
    recorder().execute,
    () => 1000
  )
  // After the minute: SpringBoard kept its pid, PosterBoard is gone, one widget came back.
  const back = PS.split('\n')
    .filter((l) => /SpringBoard$|launchd_sim$|WidgetRenderer_Default$/.test(l))
    .join('\n')
  const after = recorder({
    'verify-processes': { exitCode: 0, stdout: back },
    'verify-list-services': {
      exitCode: 0,
      stdout: LIST.replace(/.*PosterBoard.*\n?/, ''),
    },
  })
  let waited = null
  const verify = await verifyPosterWidgets('DEVICE', stopped, after.execute, {
    now: () => 31000,
    wait: async (ms) => {
      waited = ms
    },
  })
  assert.equal(waited, 30000, 'the remainder of the minute is waited')
  assert.equal(verify.afterSeconds, 30)
  assert.equal(verify.managerFound, true)
  assert.equal(verify.springboardKeptPid, true)
  assert.equal(verify.posterBoardListedAgain, false)
  assert.deepEqual(verify.running, { count: 1, names: ['WidgetRenderer_Default'] })
  assert.ok(
    after.calls.every((c) => c.binary !== 'kill'),
    'a returned job is not fought'
  )
})

test('a SpringBoard respawn and a returned PosterBoard are both recorded', async () => {
  const stopped = stopPosterWidgets(
    'DEVICE',
    PS,
    JOBS,
    MANAGER,
    recorder().execute,
    () => 0
  )
  const respawned = PS.replace(
    /^(\s*)\d+(\s+\d+\s+[\d.]+\s+.*SpringBoard)$/m,
    '$199999$2'
  )
  const after = recorder({
    'verify-processes': { exitCode: 0, stdout: respawned },
    'verify-list-services': {
      exitCode: 0,
      stdout: LIST.replace(/^\d+(\s+-?\d+\s+com\.apple\.SpringBoard)$/m, '99999$1'),
    },
  })
  const verify = await verifyPosterWidgets('DEVICE', stopped, after.execute, {
    now: () => 61000,
    wait: async () => undefined,
  })
  assert.equal(verify.springboardKeptPid, false)
  assert.equal(verify.springboardPid, 99999)
  assert.equal(verify.posterBoardListedAgain, true)
  assert.ok(verify.running.count > 5)
})

test('an unreadable process list is recorded as no manager, not as a pass', async () => {
  const stopped = stopPosterWidgets(
    'DEVICE',
    PS,
    JOBS,
    MANAGER,
    recorder().execute,
    () => 0
  )
  const verify = await verifyPosterWidgets('DEVICE', stopped, recorder().execute, {
    now: () => 61000,
    wait: async () => undefined,
  })
  assert.equal(verify.managerFound, false)
  assert.equal(verify.springboardKeptPid, false)
})

test('the quiet-services record carries the poster and widget outcome', () => {
  const quiet = { policy: ['chronod'], stopped: ['chronod'], census: {} }
  assert.deepEqual(quietServicesRecord({ quiet }), {
    version: 2,
    ...quiet,
    posterWidgets: null,
  })
  assert.equal(
    quietServicesRecord({ quiet, posterWidgets: { job: {} } }).posterWidgets.job !==
      undefined,
    true
  )
})
