import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireAdvisoryLock } from '../../../playwright/support/helpers/advisory-lock'

const databaseUrl =
  process.env.INTEGRATION_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const repo = path.resolve(__dirname, '../../..')
const tsx = path.join(repo, 'node_modules/.bin/tsx')
const lockModule = path.join(repo, 'playwright/support/helpers/advisory-lock.ts')

/**
 * A Playwright worker stand-in: its own process and database session. It takes
 * the lock `rounds` times, holding it `holdMs` each time and logging when it
 * entered and left; with `crash`, it exits holding the lock.
 */
function worker(
  directory: string,
  name: string,
  lockName: string,
  options: { rounds: number; holdMs: number; crash?: boolean }
) {
  const script = path.join(directory, `${name}.cts`)
  fs.writeFileSync(
    script,
    `const fs = require('node:fs')
const { acquireAdvisoryLock } = require(${JSON.stringify(lockModule)})
const log = ${JSON.stringify(path.join(directory, `${name}.log`))}
void (async () => {
for (let round = 0; round < ${options.rounds}; round += 1) {
  const release = await acquireAdvisoryLock(${JSON.stringify(databaseUrl)}, ${JSON.stringify(lockName)}, { timeoutMs: 30_000 })
  fs.appendFileSync(log, 'enter ' + (performance.timeOrigin + performance.now()) + '\\n')
  await new Promise((resolve) => setTimeout(resolve, ${options.holdMs}))
  ${options.crash ? "fs.appendFileSync(log, 'crash\\n'); process.exit(0)" : ''}
  fs.appendFileSync(log, 'leave ' + (performance.timeOrigin + performance.now()) + '\\n')
  await release()
}
})()
`
  )
  const child = spawn(tsx, [script], {
    cwd: repo,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  return new Promise<number | null>((resolve) => child.once('exit', resolve))
}

function intervals(directory: string, name: string) {
  const lines = fs
    .readFileSync(path.join(directory, `${name}.log`), 'utf8')
    .trim()
    .split('\n')
  const at = (line: string | undefined) => Number(line?.split(' ')[1])
  const spans: { enter: number; leave: number }[] = []
  for (let index = 0; index < lines.length; index += 2)
    spans.push({ enter: at(lines[index]), leave: at(lines[index + 1]) })
  return spans
}

describe('Playwright cross-worker advisory lock', () => {
  let directory: string
  let lockName: string
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-lock-'))
    lockName = `advisory-lock-spec:${path.basename(directory)}`
  })
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

  it('never lets two workers hold it at once', async () => {
    const exits = await Promise.all(
      ['a', 'b', 'c'].map((name) =>
        worker(directory, name, lockName, { rounds: 3, holdMs: 150 })
      )
    )
    expect(exits).toEqual([0, 0, 0])
    const spans = ['a', 'b', 'c']
      .flatMap((name) => intervals(directory, name))
      .sort((left, right) => left.enter - right.enter)
    expect(spans).toHaveLength(9)
    spans.slice(1).forEach((span, index) => {
      expect(span.enter).toBeGreaterThanOrEqual(spans[index]!.leave)
    })
  }, 60_000)

  it('is free again when a holder dies without releasing it', async () => {
    expect(
      await worker(directory, 'crashed', lockName, { rounds: 1, holdMs: 0, crash: true })
    ).toBe(0)
    expect(fs.readFileSync(path.join(directory, 'crashed.log'), 'utf8')).toContain(
      'crash'
    )
    const release = await acquireAdvisoryLock(databaseUrl, lockName, { timeoutMs: 5_000 })
    await release()
  }, 60_000)

  it('gives up at its deadline while another session holds it', async () => {
    const release = await acquireAdvisoryLock(databaseUrl, lockName, { timeoutMs: 1_000 })
    try {
      await expect(
        acquireAdvisoryLock(databaseUrl, lockName, { timeoutMs: 200 })
      ).rejects.toMatchObject({ code: '55P03' })
    } finally {
      await release()
    }
  }, 30_000)
})
