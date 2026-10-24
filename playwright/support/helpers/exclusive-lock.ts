/**
 * A lock across Playwright workers on one machine, kept as numbered generations
 * inside `directory`: `gen-1`, `gen-2`, ... The highest generation's `owner` file
 * names the holder, or says the lock is free. Every change of hands claims the
 * next generation by renaming a directory that already holds its owner file onto
 * that name: the rename succeeds for exactly one claimant, and the owner is there
 * from the first instant.
 *
 * Nothing that names the current state is deleted. Taking over from a holder
 * whose process is gone claims the next generation too, so it cannot remove a
 * newer holder's lock, and two waiters that both saw the dead holder cannot both
 * get in: the second claim of that generation fails and it looks again. A
 * generation that disappears while a waiter reads it was pruned after a newer
 * one appeared, so the waiter looks again at once.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const FREE = 'free'

/** The highest generation and its owner: a holder's token, or `free`. */
export interface ObservedLock {
  generation: number
  owner: string
}

/** Test seams at the two boundaries where another worker can act. */
export interface ExclusiveLockHooks {
  /** After the generations are listed, before the highest one is read. */
  listed?: (generation: number) => void
  /** After the state is read, before acting on it. */
  observed?: (state: ObservedLock) => void | Promise<void>
}

const generationName = (generation: number) => `gen-${generation}`

function observe(directory: string, hooks: ExclusiveLockHooks): ObservedLock | null {
  const generations = fs
    .readdirSync(directory)
    .flatMap((name) => /^gen-(\d+)$/.exec(name)?.[1] ?? [])
    .map(Number)
  if (generations.length === 0) return { generation: 0, owner: FREE }
  const generation = Math.max(...generations)
  hooks.listed?.(generation)
  try {
    const owner = fs.readFileSync(
      path.join(directory, generationName(generation), 'owner'),
      'utf8'
    )
    return { generation, owner }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function holderAlive(owner: string): boolean {
  const pid = Number(owner.split(':')[0])
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Claims `generation` for `owner`; false when another claimant got it first. */
function claim(directory: string, generation: number, owner: string): boolean {
  const ready = path.join(directory, `.claim-${randomUUID()}`)
  fs.mkdirSync(ready)
  fs.writeFileSync(path.join(ready, 'owner'), owner)
  try {
    fs.renameSync(ready, path.join(directory, generationName(generation)))
    return true
  } catch (error) {
    fs.rmSync(ready, { recursive: true, force: true })
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return false
    throw error
  }
}

/** Removes generations older than `newest`; none of them names the current state. */
function prune(directory: string, newest: number) {
  for (const name of fs.readdirSync(directory)) {
    const generation = Number(/^gen-(\d+)$/.exec(name)?.[1] ?? Number.NaN)
    if (generation < newest)
      fs.rmSync(path.join(directory, name), { recursive: true, force: true })
  }
}

export async function acquireExclusiveLock(
  directory: string,
  {
    timeoutMs,
    pollMs = 250,
    hooks = {},
  }: { timeoutMs: number; pollMs?: number; hooks?: ExclusiveLockHooks }
): Promise<() => void> {
  fs.mkdirSync(directory, { recursive: true })
  const token = `${process.pid}:${randomUUID()}`
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const state = observe(directory, hooks)
    if (state === null) continue
    await hooks.observed?.(state)
    if (state.owner === FREE || !holderAlive(state.owner)) {
      const next = state.generation + 1
      if (claim(directory, next, token)) {
        prune(directory, next)
        return releaseFor(directory, token)
      }
      // Another claimant changed hands first; look at what it left.
      continue
    }
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for the lock ${directory}`)
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/** Frees the lock while `token` still holds it, so a late second call frees nobody else's. */
function releaseFor(directory: string, token: string): () => void {
  return () => {
    for (;;) {
      const state = observe(directory, {})
      if (state === null) continue
      if (state.owner !== token) return
      if (claim(directory, state.generation + 1, FREE)) {
        prune(directory, state.generation + 1)
        return
      }
    }
  }
}
