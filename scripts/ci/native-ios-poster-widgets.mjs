/**
 * Lock-screen poster and widget processes of the owned simulator. In run 24 ten poster
 * extensions held 969 MB next to the share-card app on a 7 GB host and were the first memory
 * swapped out (swap 7 MB to 738 MB). The flows never lock the screen or use a widget.
 *
 * The extensions are not launchd jobs the simulator lists, so only PosterBoard (the job that
 * starts them) is booted out by its label; the processes the runtime shipped under its own
 * RuntimeRoot are then stopped once with SIGTERM. Nothing here loops or retries: a job that
 * comes back is recorded by `verifyPosterWidgets`, not stopped again.
 */
import path from 'node:path'
import {
  simulatorJobs,
  simulatorManager,
  ownedService,
} from './native-ios-command-evidence.mjs'

/** An executable name that carries Poster or Widget, with no path characters. */
export const POSTER_WIDGET_NAME = /^[A-Za-z0-9_.+-]*(?:Poster|Widget)[A-Za-z0-9_.+-]*$/

/** Seconds the stopped processes must stay down before the run records the verdict. */
export const VERIFY_AFTER_SECONDS = 60

const NAME_LIMIT = 40

/** Rows of `ps -A -o pid=,ppid=,%cpu=,comm=` with the full executable path kept. */
function rows(text) {
  return text.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/)
    return m
      ? [
          {
            pid: Number(m[1]),
            ppid: Number(m[2]),
            executable: m[4].trim(),
            name: path.basename(m[4].trim()),
          },
        ]
      : []
  })
}

/**
 * Owned processes this module may stop: children of the simulator manager that the runtime
 * itself shipped (under RuntimeRoot, so never the app under test) and that carry Poster or
 * Widget in the executable name.
 */
export function posterWidgetProcesses(ps, manager) {
  return rows(ps).filter(
    (row) =>
      row.ppid === manager &&
      row.pid > 1 &&
      row.executable.includes('/RuntimeRoot/') &&
      POSTER_WIDGET_NAME.test(row.name)
  )
}

const uniqueNames = (list) => [...new Set(list.map((row) => row.name))].sort()

const springboard = (ps, manager) =>
  rows(ps).find((row) => row.ppid === manager && row.name === 'SpringBoard')?.pid ?? null

/**
 * Boot out PosterBoard by its listed label, then SIGTERM the owned poster and widget processes
 * once. Every command is nonfatal; the returned record is the evidence of what was attempted.
 */
export function stopPosterWidgets(device, ps, jobs, manager, execute, now = () => 0) {
  const job = ownedService(ps, jobs, manager, 'PosterBoard')
  const bootout = job
    ? execute(
        'bootout-poster-board',
        'xcrun',
        ['simctl', 'spawn', device, 'launchctl', 'bootout', `system/${job.label}`],
        { fatal: false }
      )
    : null
  const targets = posterWidgetProcesses(ps, manager).filter(
    // The job's own process leaves with its bootout; signalling it again only reports ESRCH.
    (row) => !(bootout?.exitCode === 0 && row.name === 'PosterBoard')
  )
  const kill = targets.length
    ? execute(
        'stop-poster-widgets',
        'kill',
        ['-TERM', ...targets.map((row) => String(row.pid))],
        {
          fatal: false,
        }
      )
    : null
  const record = {
    job: { label: job?.label ?? null, bootoutExit: bootout?.exitCode ?? null },
    signalled: {
      count: targets.length,
      names: uniqueNames(targets).slice(0, NAME_LIMIT),
      exit: kill?.exitCode ?? null,
    },
    springboardPid: springboard(ps, manager),
    stoppedAt: now(),
    verify: null,
  }
  console.log(JSON.stringify({ posterWidgets: record }))
  return record
}

/**
 * What is left once the stopped processes have had time to come back: SpringBoard's pid before
 * and after (a respawn loop changes it), whether PosterBoard is listed again, and the poster and
 * widget processes that exist now. A process that returned is recorded, never stopped again.
 */
export async function verifyPosterWidgets(device, record, execute, clock) {
  const waitMs = Math.max(
    0,
    VERIFY_AFTER_SECONDS * 1000 - (clock.now() - record.stoppedAt)
  )
  await clock.wait(waitMs)
  const listed = execute(
    'verify-list-services',
    'xcrun',
    ['simctl', 'spawn', device, 'launchctl', 'list'],
    { fatal: false }
  )
  const ps = execute('verify-processes', 'ps', ['-A', '-o', 'pid=,ppid=,%cpu=,comm='], {
    fatal: false,
  })
  let manager = null
  try {
    manager = simulatorManager(ps.stdout ?? '', simulatorJobs(listed.stdout ?? ''), null)
  } catch {
    manager = null
  }
  const back = manager === null ? [] : posterWidgetProcesses(ps.stdout ?? '', manager)
  const pidNow = manager === null ? null : springboard(ps.stdout ?? '', manager)
  const verify = {
    afterSeconds: Math.round((clock.now() - record.stoppedAt) / 100) / 10,
    managerFound: manager !== null,
    springboardPid: pidNow,
    springboardKeptPid: pidNow !== null && pidNow === record.springboardPid,
    posterBoardListedAgain:
      manager !== null &&
      ownedService(
        ps.stdout ?? '',
        simulatorJobs(listed.stdout ?? ''),
        manager,
        'PosterBoard'
      ) !== undefined,
    running: { count: back.length, names: uniqueNames(back).slice(0, NAME_LIMIT) },
  }
  console.log(JSON.stringify({ posterWidgetsVerify: verify }))
  return verify
}
