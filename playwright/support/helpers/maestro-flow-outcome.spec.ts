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
  describeMissingReport,
  flowTitleOf,
  lastStartedMaestroCommand,
  newestFlowDebugLog,
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
})
