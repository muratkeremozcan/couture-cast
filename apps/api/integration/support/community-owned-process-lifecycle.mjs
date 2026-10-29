// Closed lifecycle controls for the owned acceptance-process helper.
import { createRequire } from 'node:module'

const mode = process.env.OWNED_PROCESS_LIFECYCLE
if (mode === 'missing-module')
  createRequire(import.meta.url)('./owned-process-intentionally-absent.cjs')
if (mode !== 'missing-module') process.send?.({ event: 'ready', value: { ready: true } })
if (mode === 'ready-then-exit') process.exitCode = 17
else
  process.on('message', ({ id, op }) => {
    if (op === 'exit') process.exit(17)
    else if (op === 'close') process.send?.({ id, value: null }, () => process.exit(0))
    else process.send?.({ id, value: { acknowledged: true } })
  })
if (mode === 'ready-then-exit') process.disconnect()
