// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
/**
 * Story 1.2b R28: a flow killed at the runner's watchdog leaves no JUnit report.
 * The summary must name the kill and where Maestro stopped, never only the
 * missing file. See scripts/lib/maestro-flow-outcome.mjs.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addFlowFailureCause,
  decodeXmlText,
  describeMissingReport,
  flowTitleOf,
  lastStartedMaestroCommand,
  maestroFlowTitle,
  newestFlowDebugLog,
  removeReportEverywhere,
} from '../../../scripts/lib/maestro-flow-outcome.mjs'

const HUNG_LOG = [
  '09:52:05.272 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Define variables RUNNING',
  '09:52:05.276 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandFinished: Define variables COMPLETED',
  '09:52:06.341 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Launch app "${MAESTRO_APP_ID}" with clear state without stopping app RUNNING',
  '09:52:06.351 [ INFO] maestro.Maestro.clearAppState$lambda$8: Clearing app state host.exp.exponent',
].join('\n')

let directory: string | undefined

afterEach(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
  directory = undefined
})

describe('Maestro flow outcome without a JUnit report', () => {
  it('1.2b-R28-01 names the watchdog kill and the last command Maestro started', () => {
    const timeout = Object.assign(new Error('maestro timed out after 360000ms'), {
      timedOut: true,
    })

    expect(
      describeMissingReport(
        'maestro/community-feed.yaml',
        'ENOENT: no such file or directory',
        timeout,
        lastStartedMaestroCommand(HUNG_LOG)
      )
    ).toBe(
      'maestro/community-feed.yaml (maestro timed out after 360000ms, last command started: ' +
        'Launch app "${MAESTRO_APP_ID}" with clear state without stopping app; ' +
        'Maestro wrote no JUnit report)'
    )
  })

  it('1.2b-R28-02 keeps the unreadable-report reason when Maestro itself exited cleanly', () => {
    expect(
      describeMissingReport('maestro/a.yaml', 'malformed XML', undefined, undefined)
    ).toBe('maestro/a.yaml (JUnit report unreadable: malformed XML)')
  })

  it('1.2b-R28-03 reads the flow name Maestro files its debug output under', () => {
    expect(
      flowTitleOf(
        "appId: ${MAESTRO_APP_ID}\nname: 'Community feed by climate band'\n---\n- launchApp\n"
      )
    ).toBe('Community feed by climate band')
    expect(flowTitleOf('appId: x\n---\n- name: not the header\n')).toBeUndefined()
  })

  it('1.2b-R28-04 finds the newest debug log for a flow across Maestro runs', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-outcome-'))
    const write = (run: string, text: string, mtime: number) => {
      const file = path.join(directory!, run, 'Community feed', 'logs', 'maestro.log')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text)
      fs.utimesSync(file, mtime, mtime)
      return file
    }
    write('2026-10-23_095156', 'first attempt', 1_000)
    const retry = write('2026-10-23_095758', HUNG_LOG, 2_000)

    expect(newestFlowDebugLog(directory, 'Community feed')).toBe(retry)
    expect(newestFlowDebugLog(directory, 'Another flow')).toBeUndefined()
    expect(
      newestFlowDebugLog(path.join(directory, 'missing'), 'Community feed')
    ).toBeUndefined()
  })
  it('1.2b-R29-07 removes every same-named report, the nested stale ones included', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-outcome-'))
    const exact = path.join(directory, 'community-feed-report.xml')
    const nested = path.join(
      directory,
      '2026-10-22_130422',
      'old',
      'community-feed-report.xml'
    )
    const other = path.join(directory, 'deep-link-handling-report.xml')
    for (const file of [exact, nested, other]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, '<testsuites/>')
    }

    expect(removeReportEverywhere(directory, exact).sort()).toEqual(
      [exact, nested].sort()
    )
    expect(fs.existsSync(exact)).toBe(false)
    expect(fs.existsSync(nested)).toBe(false)
    expect(fs.existsSync(other)).toBe(true)
  })

  it('1.2b-R29-08 names a step only from a log written since the flow started', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-outcome-'))
    const file = path.join(
      directory,
      '2026-10-22_090000',
      'Community feed',
      'logs',
      'maestro.log'
    )
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, HUNG_LOG)
    fs.utimesSync(file, 1_000, 1_000)

    expect(
      newestFlowDebugLog(directory, 'Community feed', { sinceMs: 2_000_000 })
    ).toBeUndefined()
    expect(newestFlowDebugLog(directory, 'Community feed', { sinceMs: 500_000 })).toBe(
      file
    )
  })

  // Maestro 2.8 TestDebugReporter.resolveFlowDir (maestro-cli-2.8.0.jar): the flow's title
  // with "/" turned into "_", then "-shard-<index + 1>" when TestCommand splits the run into
  // more than one shard, then "-2", "-3"... while that folder already exists. An iOS run of
  // run-maestro-shards.mjs passes two or more simulators, so every iOS flow lands in a
  // "-shard-N" folder.
  it('PR252-R1-01 finds a flow under every folder name Maestro 2.8 gives it', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-outcome-'))
    const write = (run: string, folder: string, mtime: number) => {
      const file = path.join(directory!, run, folder, 'logs', 'maestro.log')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, folder)
      fs.utimesSync(file, mtime, mtime)
      return file
    }
    const title = 'Guest preview journey'

    const plain = write('2026-11-17_100000', title, 1_000)
    expect(newestFlowDebugLog(directory, title)).toBe(plain)
    const shard = write('2026-11-17_100100', `${title}-shard-1`, 2_000)
    expect(newestFlowDebugLog(directory, title)).toBe(shard)
    const collision = write('2026-11-17_100200', `${title}-2`, 3_000)
    expect(newestFlowDebugLog(directory, title)).toBe(collision)
    const shardCollision = write('2026-11-17_100300', `${title}-shard-2-3`, 4_000)
    expect(newestFlowDebugLog(directory, title)).toBe(shardCollision)

    // Another flow whose title only starts the same way is never this flow's log.
    write('2026-11-17_100400', `${title} extended`, 5_000)
    write('2026-11-17_100400', `${title}-shard-`, 5_000)
    expect(newestFlowDebugLog(directory, title)).toBe(shardCollision)

    const slashed = write('2026-11-17_100000', 'Share_card export-shard-2', 1_000)
    expect(newestFlowDebugLog(directory, 'Share/card export')).toBe(slashed)
  })

  it('PR252-R2-01 names a flow without name: by its file, as Maestro does', () => {
    // maestro/share-card-export.yaml has no name:, so Maestro files it as share-card-export.
    const flow = 'maestro/share-card-export.yaml'
    const yaml = fs.readFileSync(flow, 'utf8')
    expect(flowTitleOf(yaml)).toBeUndefined()
    expect(maestroFlowTitle(flow, yaml)).toBe('share-card-export')
    expect(
      maestroFlowTitle(
        'maestro/guest-preview.yaml',
        fs.readFileSync('maestro/guest-preview.yaml', 'utf8')
      )
    ).toBe('Guest preview journey')
  })

  it('PR252-R1-02 counts a guard failure on an iOS flow the report already failed once', () => {
    // The iOS sharded report lists flows by title, so its failure entry is the title.
    const failures = ['Guest preview journey']
    const passes = new Set<string>()
    addFlowFailureCause(failures, passes, 'maestro/guest-preview.yaml', 'pinned', {
      reportedAs: 'Guest preview journey',
    })
    expect(failures).toEqual(['Guest preview journey (pinned)'])
    expect(passes.size + failures.length).toBe(1)
  })

  it('PR252-R1-03 turns an iOS pass the report counted by title into one failure', () => {
    const failures: string[] = []
    const passes = new Set(['Guest preview journey'])
    addFlowFailureCause(failures, passes, 'maestro/guest-preview.yaml', 'pinned', {
      reportedAs: 'Guest preview journey',
    })
    expect([...passes]).toEqual([])
    expect(failures).toEqual(['maestro/guest-preview.yaml (pinned)'])
  })

  it('PR252-R1-04 still matches the flow path on the serial and Android paths', () => {
    const failures = ['maestro/a.yaml (Maestro failed)', 'maestro/b.yaml']
    const passes = new Set(['maestro/c.yaml'])
    addFlowFailureCause(failures, passes, 'maestro/a.yaml', 'pinned')
    addFlowFailureCause(failures, passes, 'maestro/c.yaml', 'pinned')
    expect(failures).toEqual([
      'maestro/a.yaml (Maestro failed) (pinned)',
      'maestro/b.yaml',
      'maestro/c.yaml (pinned)',
    ])
    expect([...passes]).toEqual([])
  })

  it('PR252-R1-05 reads a JUnit name the way the flow spells its title', () => {
    // Maestro escapes the report's attributes; the iOS report is matched to a flow by title.
    expect(decodeXmlText('Chip navigation &amp; sticky bottom nav flow')).toBe(
      'Chip navigation & sticky bottom nav flow'
    )
    expect(decodeXmlText('&quot;a&quot; &lt;b&gt; &apos;c&apos; &#38;amp; &#x41;')).toBe(
      '"a" <b> \'c\' &amp; A'
    )
  })
})
