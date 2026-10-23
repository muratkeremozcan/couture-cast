/**
 * A lock across Playwright workers on one machine: `mkdir` either creates the
 * directory or fails, atomically, so exactly one holder exists. The holder's pid
 * is written inside; a lock whose holder process is gone is stale and is taken
 * over, so a crashed worker cannot block later runs.
 */
import fs from 'node:fs'
import path from 'node:path'

function holderAlive(directory: string): boolean {
  try {
    const pid = Number(fs.readFileSync(path.join(directory, 'pid'), 'utf8'))
    if (!Number.isInteger(pid) || pid <= 0) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function acquireExclusiveLock(
  directory: string,
  { timeoutMs, pollMs = 250 }: { timeoutMs: number; pollMs?: number }
): Promise<() => void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      fs.mkdirSync(directory)
      fs.writeFileSync(path.join(directory, 'pid'), String(process.pid))
      return () => fs.rmSync(directory, { recursive: true, force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // The holder may still be writing its pid; only a lock old enough to have
      // one, whose holder is gone, is taken over.
      const age = Date.now() - fs.statSync(directory, { throwIfNoEntry: false })!.mtimeMs
      if (age > 2_000 && !holderAlive(directory))
        fs.rmSync(directory, { recursive: true, force: true })
    }
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for the lock ${directory}`)
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
