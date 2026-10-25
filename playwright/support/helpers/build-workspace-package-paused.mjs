#!/usr/bin/env node
/**
 * Test-only entry for scripts/build-workspace-package.mjs: runs the same build,
 * blocking the process after one publication step, the way a stalled disk or
 * a suspended process would (Story 6.7b R25/R28). The production script has
 * no pause of its own; `build-workspace-package.spec.ts` starts this instead.
 *
 *   PAUSE_AFTER_STEP=first|last PAUSE_MS=<ms> node build-workspace-package-paused.mjs [--tsc ...]
 *
 * `UTIMES_PAUSE_MS` instead stalls the process after its first stamp on the lock
 * (`proper-lockfile`'s first `utimes`) has completed and before the completion is
 * seen, the window in which another build can take the lock over (R29).
 */
import fs from 'node:fs'
import { runBuild } from '../../../scripts/build-workspace-package.mjs'

const utimesPauseMs = Number(process.env.UTIMES_PAUSE_MS || 0)
if (utimesPauseMs > 0) {
  const utimes = fs.utimes.bind(fs)
  let paused = false
  fs.utimes = (target, atime, mtime, callback) =>
    utimes(target, atime, mtime, (error) => {
      if (!paused && String(target).endsWith('.dist-build-lock')) {
        paused = true
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, utimesPauseMs)
      }
      callback(error)
    })
}

const at = process.env.PAUSE_AFTER_STEP
const pauseMs = Number(process.env.PAUSE_MS || 0)

await runBuild({
  afterStep: (done, total) => {
    if ((at === 'first' && done === 1) || (at === 'last' && done === total))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs)
  },
})
