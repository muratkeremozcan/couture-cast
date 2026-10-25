#!/usr/bin/env node
/**
 * Test-only entry for scripts/build-workspace-package.mjs: runs the same build,
 * blocking the process after one publication step, the way a stalled disk or
 * a suspended process would (Story 6.7b R25/R28). The production script has
 * no pause of its own; `build-workspace-package.spec.ts` starts this instead.
 *
 *   PAUSE_AFTER_STEP=first|last PAUSE_MS=<ms> node build-workspace-package-paused.mjs [--tsc ...]
 */
import { runBuild } from '../../../scripts/build-workspace-package.mjs'

const at = process.env.PAUSE_AFTER_STEP
const pauseMs = Number(process.env.PAUSE_MS || 0)

await runBuild({
  afterStep: (done, total) => {
    if ((at === 'first' && done === 1) || (at === 'last' && done === total))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs)
  },
})
