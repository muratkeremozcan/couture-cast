// Story 6.2b peer review (CX8): the local E2E teardown stops the stack it
// started, and only that one. A single shared pid file let one checkout's or one
// port's run signal another's stack, and a stale record could signal whatever
// process reused its pid.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')

interface StackRecord {
  pid: number
  startedAt: string
  token: string
}
interface StackModule {
  E2E_STACK_LAUNCHER: string
  e2eStackRecordPath: (root: string, port: string | number, directory?: string) => string
  writeE2eStackRecord: (recordPath: string, pid?: number) => StackRecord
  readE2eStackRecord: (recordPath: string) => StackRecord | null
  removeE2eStackRecordIfOwned: (recordPath: string, token: string) => boolean
  isE2eStackLauncher: (pid: number) => boolean
  stopE2eStack: (recordPath: string, options?: { timeoutMs?: number }) => Promise<string>
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

/** A long-lived node process whose command line carries `marker`. */
async function spawnProcess(marker: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], {
    stdio: 'ignore',
  })
  children.push(child)
  await new Promise((resolve) => child.once('spawn', resolve))
  return child
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

  it('never removes a record another run has since written', async () => {
    const { writeE2eStackRecord, readE2eStackRecord, removeE2eStackRecordIfOwned } =
      await load()
    const recordPath = path.join(tempDirectory(), 'stack.json')
    const first = writeE2eStackRecord(recordPath, 101)
    const second = writeE2eStackRecord(recordPath, 202)

    expect(removeE2eStackRecordIfOwned(recordPath, first.token)).toBe(false)
    expect(readE2eStackRecord(recordPath)).toEqual(second)
    expect(removeE2eStackRecordIfOwned(recordPath, second.token)).toBe(true)
    expect(readE2eStackRecord(recordPath)).toBeNull()
  })

  it('stops the launcher its record names', async () => {
    const { E2E_STACK_LAUNCHER, writeE2eStackRecord, stopE2eStack } = await load()
    const launcher = await spawnProcess(`scripts/${E2E_STACK_LAUNCHER}.mjs`)
    const recordPath = path.join(tempDirectory(), 'stack.json')
    writeE2eStackRecord(recordPath, launcher.pid)

    await expect(stopE2eStack(recordPath)).resolves.toBe('stopped')
    expect(launcher.signalCode).toBe('SIGTERM')
  })

  it('signals nothing when the recorded pid now runs something else', async () => {
    const { writeE2eStackRecord, readE2eStackRecord, stopE2eStack, isE2eStackLauncher } =
      await load()
    const bystander = await spawnProcess('some-other-program')
    const recordPath = path.join(tempDirectory(), 'stack.json')
    writeE2eStackRecord(recordPath, bystander.pid)

    expect(isE2eStackLauncher(bystander.pid!)).toBe(false)
    await expect(stopE2eStack(recordPath)).resolves.toBe('stale-record')
    expect(alive(bystander)).toBe(true)
    expect(readE2eStackRecord(recordPath)).toBeNull()
  })

  it("leaves another port's stack running", async () => {
    const { E2E_STACK_LAUNCHER, e2eStackRecordPath, writeE2eStackRecord, stopE2eStack } =
      await load()
    const directory = tempDirectory()
    const other = await spawnProcess(`scripts/${E2E_STACK_LAUNCHER}.mjs`)
    writeE2eStackRecord(e2eStackRecordPath(repoRoot, '3006', directory), other.pid)

    await expect(
      stopE2eStack(e2eStackRecordPath(repoRoot, '3005', directory))
    ).resolves.toBe('no-record')
    expect(alive(other)).toBe(true)
  })
})
