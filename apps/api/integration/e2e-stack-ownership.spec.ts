// Learning path Step 40: Community screening release gate and hosted worker.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-40-community-screening-release-gate-and-hosted-worker
// Story 6.2b peer review (CX8): the local E2E teardown stops the stack it
// started, and only that one. A single shared pid file let one checkout's or one
// port's run signal another's stack, and a stale record could signal whatever
// process reused its pid.
//
// Story 6.2b second peer review (CX8b): a stale record's pid can be reused by
// another checkout's launcher, whose command line also names the launcher
// script. The record carries the OS start time and the absolute launcher path,
// and the teardown re-reads both from the live process before it signals. Every
// case below runs against real spawned processes and the real `ps`.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')

interface StackRecord {
  pid: number
  processStartedAt: string
  launcherPath: string
  writtenAt: string
  token: string
}
interface ProcessIdentity {
  startedAt: string
  command: string
}
interface StackModule {
  E2E_STACK_LAUNCHER: string
  e2eStackLauncherPath: (root: string) => string
  e2eStackRecordPath: (root: string, port: string | number, directory?: string) => string
  readProcessIdentity: (pid: number) => ProcessIdentity | null
  commandHasArgument: (command: string, argument: string) => boolean
  writeE2eStackRecord: (
    recordPath: string,
    options: { pid?: number; launcherPath: string }
  ) => StackRecord | null
  readE2eStackRecord: (recordPath: string) => StackRecord | null
  removeE2eStackRecordIfOwned: (recordPath: string, token: string) => boolean
  stopE2eStack: (
    recordPath: string,
    options: { expectedLauncherPath: string; timeoutMs?: number }
  ) => Promise<string>
}

const load = async () =>
  (await import(path.join(repoRoot, 'scripts/e2e-stack-pid.mjs'))) as StackModule

const children: ChildProcess[] = []
const directories: string[] = []

function tempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-stack-ownership-'))
  directories.push(directory)
  return directory
}

/** A checkout directory holding a launcher script, and that script's absolute path. */
async function checkout(name: string): Promise<{ root: string; launcher: string }> {
  const { E2E_STACK_LAUNCHER, e2eStackLauncherPath } = await load()
  const root = path.join(tempDirectory(), name)
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts', `${E2E_STACK_LAUNCHER}.mjs`), '')
  return { root, launcher: e2eStackLauncherPath(root) }
}

/** A long-lived node process whose command line carries `argument`. */
async function spawnProcess(argument: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', argument], {
    stdio: 'ignore',
  })
  children.push(child)
  await new Promise((resolve) => child.once('spawn', resolve))
  return child
}

/** Writes a record the way a launcher would have, with fields overridden. */
function writeRecord(recordPath: string, record: Partial<StackRecord>): StackRecord {
  const full = {
    pid: 1,
    processStartedAt: 'Thu Jan  1 00:00:00 1970',
    launcherPath: '/nowhere/scripts/start-api-e2e-with-workers.mjs',
    writtenAt: new Date().toISOString(),
    token: 'token-1',
    ...record,
  }
  fs.writeFileSync(recordPath, `${JSON.stringify(full)}\n`)
  return full
}

const alive = (child: ChildProcess) =>
  child.exitCode === null && child.signalCode === null

afterEach(() => {
  for (const child of children.splice(0)) if (alive(child)) child.kill('SIGKILL')
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('E2E stack ownership record', () => {
  it('keys the record by checkout and web port', async () => {
    const { e2eStackRecordPath } = await load()
    const directory = tempDirectory()
    const here = e2eStackRecordPath(repoRoot, '3005', directory)
    expect(e2eStackRecordPath(repoRoot, 3005, directory)).toBe(here)
    expect(e2eStackRecordPath(repoRoot, '3006', directory)).not.toBe(here)
    expect(e2eStackRecordPath(path.join(repoRoot, 'apps'), '3005', directory)).not.toBe(
      here
    )
  })

  it('records the launcher OS start time and absolute path', async () => {
    const { writeE2eStackRecord, readE2eStackRecord, readProcessIdentity } = await load()
    const here = await checkout('here')
    const launcher = await spawnProcess(here.launcher)
    const recordPath = path.join(tempDirectory(), 'stack.json')

    const record = writeE2eStackRecord(recordPath, {
      pid: launcher.pid,
      launcherPath: here.launcher,
    })

    expect(record).not.toBeNull()
    expect(path.isAbsolute(record!.launcherPath)).toBe(true)
    expect(record!.processStartedAt).toBe(readProcessIdentity(launcher.pid!)?.startedAt)
    expect(record!.processStartedAt).toMatch(/\d{2}:\d{2}:\d{2} \d{4}$/)
    expect(readE2eStackRecord(recordPath)).toEqual(record)
  })

  it('writes no record for a launcher started through a relative path', async () => {
    const { E2E_STACK_LAUNCHER, writeE2eStackRecord } = await load()
    const here = await checkout('here')
    const launcher = await spawnProcess(`scripts/${E2E_STACK_LAUNCHER}.mjs`)
    const recordPath = path.join(tempDirectory(), 'stack.json')

    expect(
      writeE2eStackRecord(recordPath, { pid: launcher.pid, launcherPath: here.launcher })
    ).toBeNull()
    expect(fs.existsSync(recordPath)).toBe(false)
  })

  it('never removes a record another run has since written', async () => {
    const { writeE2eStackRecord, readE2eStackRecord, removeE2eStackRecordIfOwned } =
      await load()
    const here = await checkout('here')
    const recordPath = path.join(tempDirectory(), 'stack.json')
    const firstLauncher = await spawnProcess(here.launcher)
    const secondLauncher = await spawnProcess(here.launcher)
    const first = writeE2eStackRecord(recordPath, {
      pid: firstLauncher.pid,
      launcherPath: here.launcher,
    })!
    const second = writeE2eStackRecord(recordPath, {
      pid: secondLauncher.pid,
      launcherPath: here.launcher,
    })!

    expect(removeE2eStackRecordIfOwned(recordPath, first.token)).toBe(false)
    expect(readE2eStackRecord(recordPath)).toEqual(second)
    expect(removeE2eStackRecordIfOwned(recordPath, second.token)).toBe(true)
    expect(readE2eStackRecord(recordPath)).toBeNull()
  })

  it('stops the launcher its record names', async () => {
    const { writeE2eStackRecord, stopE2eStack } = await load()
    const here = await checkout('here')
    const launcher = await spawnProcess(here.launcher)
    const recordPath = path.join(tempDirectory(), 'stack.json')
    writeE2eStackRecord(recordPath, { pid: launcher.pid, launcherPath: here.launcher })

    await expect(
      stopE2eStack(recordPath, { expectedLauncherPath: here.launcher })
    ).resolves.toBe('stopped')
    expect(launcher.signalCode).toBe('SIGTERM')
  })

  it("leaves another checkout's launcher running when it reused the recorded pid", async () => {
    const { readProcessIdentity, readE2eStackRecord, stopE2eStack } = await load()
    const here = await checkout('here')
    const there = await checkout('there')
    // Another checkout's launcher now holds the pid this checkout's stale record
    // names. Even with the start time matching, its command line carries the
    // other checkout's launcher path, not this one's.
    const other = await spawnProcess(there.launcher)
    const recordPath = path.join(tempDirectory(), 'stack.json')
    writeRecord(recordPath, {
      pid: other.pid,
      processStartedAt: readProcessIdentity(other.pid!)!.startedAt,
      launcherPath: here.launcher,
    })

    await expect(
      stopE2eStack(recordPath, { expectedLauncherPath: here.launcher })
    ).resolves.toBe('command-mismatch')
    expect(alive(other)).toBe(true)
    expect(readE2eStackRecord(recordPath)).toBeNull()
  })

  it('leaves a launcher running whose path only ends with this checkout path', async () => {
    const { readProcessIdentity, stopE2eStack, commandHasArgument } = await load()
    const here = await checkout('here')
    const nested = `/elsewhere${here.launcher}`
    const other = await spawnProcess(nested)
    const recordPath = path.join(tempDirectory(), 'stack.json')
    writeRecord(recordPath, {
      pid: other.pid,
      processStartedAt: readProcessIdentity(other.pid!)!.startedAt,
      launcherPath: here.launcher,
    })

    expect(commandHasArgument(`node ${nested}`, here.launcher)).toBe(false)
    expect(commandHasArgument(`node ${here.launcher} --with-web`, here.launcher)).toBe(
      true
    )
    await expect(
      stopE2eStack(recordPath, { expectedLauncherPath: here.launcher })
    ).resolves.toBe('command-mismatch')
    expect(alive(other)).toBe(true)
  })

  it('leaves a process running whose start time differs from the record', async () => {
    const { stopE2eStack } = await load()
    const here = await checkout('here')
    // This checkout's own launcher path, but a later process than the one that
    // wrote the record: the pid was reused.
    const reused = await spawnProcess(here.launcher)
    const recordPath = path.join(tempDirectory(), 'stack.json')
    writeRecord(recordPath, {
      pid: reused.pid,
      processStartedAt: 'Thu Jan  1 00:00:00 1970',
      launcherPath: here.launcher,
    })

    await expect(
      stopE2eStack(recordPath, { expectedLauncherPath: here.launcher })
    ).resolves.toBe('start-time-mismatch')
    expect(alive(reused)).toBe(true)
  })

  it("refuses a record that names another checkout's launcher", async () => {
    const { writeE2eStackRecord, stopE2eStack } = await load()
    const here = await checkout('here')
    const there = await checkout('there')
    const other = await spawnProcess(there.launcher)
    const recordPath = path.join(tempDirectory(), 'stack.json')
    writeE2eStackRecord(recordPath, { pid: other.pid, launcherPath: there.launcher })

    await expect(
      stopE2eStack(recordPath, { expectedLauncherPath: here.launcher })
    ).resolves.toBe('launcher-path-mismatch')
    expect(alive(other)).toBe(true)
  })

  it('signals nothing when the recorded pid no longer runs', async () => {
    const { writeE2eStackRecord, stopE2eStack } = await load()
    const here = await checkout('here')
    const launcher = await spawnProcess(here.launcher)
    const recordPath = path.join(tempDirectory(), 'stack.json')
    writeE2eStackRecord(recordPath, { pid: launcher.pid, launcherPath: here.launcher })
    launcher.kill('SIGKILL')
    await new Promise((resolve) => launcher.once('exit', resolve))

    await expect(
      stopE2eStack(recordPath, { expectedLauncherPath: here.launcher })
    ).resolves.toBe('not-running')
  })

  it('signals nothing for a record without the launcher identity', async () => {
    const { readE2eStackRecord, stopE2eStack } = await load()
    const here = await checkout('here')
    const launcher = await spawnProcess(here.launcher)
    const recordPath = path.join(tempDirectory(), 'stack.json')
    // The pre-CX8b shape: a pid and a token, nothing to verify the process by.
    fs.writeFileSync(
      recordPath,
      JSON.stringify({ pid: launcher.pid, startedAt: 'x', token: 't' })
    )

    expect(readE2eStackRecord(recordPath)).toBeNull()
    await expect(
      stopE2eStack(recordPath, { expectedLauncherPath: here.launcher })
    ).resolves.toBe('unreadable-record')
    expect(alive(launcher)).toBe(true)
    expect(fs.existsSync(recordPath)).toBe(false)
  })

  it("leaves another port's stack running", async () => {
    const { e2eStackRecordPath, writeE2eStackRecord, stopE2eStack } = await load()
    const here = await checkout('here')
    const directory = tempDirectory()
    const other = await spawnProcess(here.launcher)
    writeE2eStackRecord(e2eStackRecordPath(here.root, '3006', directory), {
      pid: other.pid,
      launcherPath: here.launcher,
    })

    await expect(
      stopE2eStack(e2eStackRecordPath(here.root, '3005', directory), {
        expectedLauncherPath: here.launcher,
      })
    ).resolves.toBe('no-record')
    expect(alive(other)).toBe(true)
  })

  it('starts the Playwright stack through the absolute launcher path', () => {
    const config = fs.readFileSync(
      path.join(repoRoot, 'playwright/config/local.config.ts'),
      'utf8'
    )
    expect(config).toContain('e2eStackLauncherPath(repoRoot)')
    expect(config).not.toContain("'node scripts/start-api-e2e-with-workers.mjs")
  })
})
