import os from 'node:os'
import path from 'node:path'

/**
 * Where the local E2E stack launcher (scripts/start-api-e2e-with-workers.mjs)
 * records its pid, so the Playwright global teardown can stop the stack's
 * workers before it resets the database they poll.
 */
export const E2E_STACK_PID_FILE = path.join(os.tmpdir(), 'couture-cast-e2e-stack.pid')
