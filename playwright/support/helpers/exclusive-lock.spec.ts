import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireExclusiveLock, type ObservedLock } from './exclusive-lock'

const settle = () => new Promise((resolve) => setTimeout(resolve, 100))

describe('exclusive lock across Playwright workers', () => {
  let root: string
  let lock: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'exclusive-lock-'))
    lock = path.join(root, 'lock')
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const generations = () =>
    fs
      .readdirSync(lock)
      .filter((name) => name.startsWith('gen-'))
      .sort()
  const ownerOf = (generation: string) =>
    fs.readFileSync(path.join(lock, generation, 'owner'), 'utf8')

  async function deadPid() {
    const child = spawn(process.execPath, ['-e', ''])
    await new Promise((resolve) => child.once('exit', resolve))
    return child.pid!
  }

  function writeGeneration(generation: number, owner: string) {
    fs.mkdirSync(path.join(lock, `gen-${generation}`), { recursive: true })
    fs.writeFileSync(path.join(lock, `gen-${generation}`, 'owner'), owner)
  }

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
    await settle()
    order.push('first-releases')
    releaseFirst()
    ;(await second)()
    expect(order).toEqual(['first-releases', 'second'])
    expect(ownerOf(generations().at(-1)!)).toBe('free')
  })

  it('takes over a lock whose holder process is gone', async () => {
    writeGeneration(1, `${await deadPid()}:gone`)
    const release = await acquireExclusiveLock(lock, { timeoutMs: 2_000, pollMs: 10 })
    expect(generations()).toEqual(['gen-2'])
    expect(ownerOf('gen-2')).toMatch(new RegExp(`^${process.pid}:`))
    release()
  })

  it('admits one of two waiters that both saw the dead holder, and keeps its lock', async () => {
    writeGeneration(1, `${await deadPid()}:gone`)
    let arrived = 0
    let open: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (open = resolve))
    // Both waiters judge generation 1 stale before either acts on it.
    const observed = async (state: ObservedLock) => {
      if (state.generation !== 1) return
      arrived += 1
      if (arrived === 2) open()
      await gate
    }
    const admitted: string[] = []
    const waiter = (name: string) =>
      acquireExclusiveLock(lock, {
        timeoutMs: 5_000,
        pollMs: 10,
        hooks: { observed },
      }).then((release) => {
        admitted.push(name)
        return release
      })
    const first = waiter('a')
    const second = waiter('b')
    await settle()

    expect(admitted).toHaveLength(1)
    expect(generations()).toEqual(['gen-2'])
    const holder = ownerOf('gen-2')
    ;(await (admitted[0] === 'a' ? first : second))()
    // The replacement's lock was never removed: the other waiter gets in only now.
    ;(await (admitted[0] === 'a' ? second : first))()
    expect(admitted).toHaveLength(2)
    expect(ownerOf(generations().at(-1)!)).toBe('free')
    expect(holder).toMatch(new RegExp(`^${process.pid}:`))
  })

  it('looks again when the generation it listed is released and pruned before it reads it', async () => {
    writeGeneration(1, `${process.pid}:live-holder`)
    let interfered = false
    const release = await acquireExclusiveLock(lock, {
      timeoutMs: 2_000,
      pollMs: 10,
      hooks: {
        listed: (generation) => {
          if (interfered || generation !== 1) return
          interfered = true
          // The holder releases (generation 2, free) and prunes generation 1.
          writeGeneration(2, 'free')
          fs.rmSync(path.join(lock, 'gen-1'), { recursive: true })
        },
      },
    })
    expect(interfered).toBe(true)
    expect(generations()).toEqual(['gen-3'])
    release()
  })

  it('frees only a lock it still holds: a second release leaves the next holder in', async () => {
    const releaseFirst = await acquireExclusiveLock(lock, {
      timeoutMs: 1_000,
      pollMs: 10,
    })
    releaseFirst()
    const releaseSecond = await acquireExclusiveLock(lock, {
      timeoutMs: 1_000,
      pollMs: 10,
    })
    const held = generations().at(-1)!
    releaseFirst()
    expect(generations().at(-1)).toBe(held)
    await expect(
      acquireExclusiveLock(lock, { timeoutMs: 100, pollMs: 10 })
    ).rejects.toThrow(/Timed out waiting for the lock/)
    releaseSecond()
  })

  it('waits for a live holder and gives up at its deadline', async () => {
    writeGeneration(1, `${process.pid}:live-holder`)
    await expect(
      acquireExclusiveLock(lock, { timeoutMs: 100, pollMs: 10 })
    ).rejects.toThrow(/Timed out waiting for the lock/)
    expect(ownerOf('gen-1')).toBe(`${process.pid}:live-holder`)
  })
})
