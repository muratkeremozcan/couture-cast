import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireExclusiveLock } from './exclusive-lock'

describe('exclusive lock across Playwright workers', () => {
  let root: string
  let lock: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'exclusive-lock-'))
    lock = path.join(root, 'lock')
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('lets one holder in at a time and the next one in after release', async () => {
    const order: string[] = []
    const releaseFirst = await acquireExclusiveLock(lock, {
      timeoutMs: 5_000,
      pollMs: 10,
    })
    const second = acquireExclusiveLock(lock, { timeoutMs: 5_000, pollMs: 10 }).then(
      (release) => {
        order.push('second')
        return release
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    order.push('first-releases')
    releaseFirst()
    ;(await second)()
    expect(order).toEqual(['first-releases', 'second'])
    expect(fs.existsSync(lock)).toBe(false)
  })

  it('takes over a lock whose holder process is gone', async () => {
    const child = spawn(process.execPath, ['-e', ''])
    await new Promise((resolve) => child.once('exit', resolve))
    fs.mkdirSync(lock)
    fs.writeFileSync(path.join(lock, 'pid'), String(child.pid))
    const old = new Date(Date.now() - 10_000)
    fs.utimesSync(lock, old, old)
    const release = await acquireExclusiveLock(lock, { timeoutMs: 2_000, pollMs: 10 })
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8')).toBe(String(process.pid))
    release()
  })

  it('waits for a live holder and gives up at its deadline', async () => {
    fs.mkdirSync(lock)
    fs.writeFileSync(path.join(lock, 'pid'), String(process.pid))
    await expect(
      acquireExclusiveLock(lock, { timeoutMs: 100, pollMs: 10 })
    ).rejects.toThrow(/Timed out waiting for the lock/)
  })
})
