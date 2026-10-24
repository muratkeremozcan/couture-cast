#!/usr/bin/env node
/**
 * Stands in for Playwright in `real-session-lifecycle.spec.ts`: a leader process
 * that starts test workers `a` and `b`, which create Auth users the way
 * `createRealCommunityAuthAccount` does, through the real write-ahead record in
 * `scripts/e2e-real-session/identities.mjs`.
 *
 *   node real-session-fake-playwright.mjs leader <control dir> <run dir> <auth dir>
 *
 * The test drives each worker through barrier files in the control directory. For
 * identity `i` worker `w` waits for `w-go-<i>`, records the pending row and marks
 * `w-pending-<i>`; waits for `w-create-<i>`, creates the user in the stand-in Auth
 * server (a file named by its id, holding its address, in the auth directory) and
 * marks `w-created-<i>`; waits for `w-record-<i>`, records the created account and
 * marks `w-recorded-<i>`. Two workers let the test stop the run with identities
 * held at different steps at once.
 *
 * The leader exits on SIGTERM, as Playwright does. The workers ignore SIGTERM, so
 * only SIGKILL to the process group ends them: the case where stopping the leader
 * alone would leave a worker free to keep creating users.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  recordCreatedIdentity,
  recordPendingIdentity,
} from '../../../scripts/e2e-real-session/identities.mjs'

const [role, control, runDir, authDir, name] = process.argv.slice(2)
const mark = (file, content = '') => fs.writeFileSync(path.join(control, file), content)
const waitFor = async (file) => {
  while (!fs.existsSync(path.join(control, file)))
    await new Promise((resolve) => setTimeout(resolve, 10))
}

if (role === 'leader') {
  for (const worker of ['a', 'b'])
    spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), 'worker', control, runDir, authDir, worker],
      { stdio: 'inherit' }
    )
  process.on('SIGTERM', () => process.exit(143))
  mark('leader.pid', String(process.pid))
  // Keeps the leader alive until it is signalled.
  setInterval(() => undefined, 60_000)
} else {
  process.on('SIGTERM', () => mark(`${name}-ignored-sigterm`))
  mark(`${name}.pid`, String(process.pid))
  const label = (step, index) => `${name}-${step}-${index}`
  for (let index = 0; ; index++) {
    await waitFor(label('go', index))
    const email = `story65-real-${randomUUID()}@example.test`
    const row = {
      email,
      appUserId: null,
      mapping: 'no-app-account',
      issueMode: 'generated',
      label: `identity-${name}-${index}`,
    }
    recordPendingIdentity(runDir, row)
    mark(label('pending', index), email)
    await waitFor(label('create', index))
    const authUserId = randomUUID()
    fs.writeFileSync(path.join(authDir, authUserId), email)
    mark(label('created', index), authUserId)
    await waitFor(label('record', index))
    recordCreatedIdentity(runDir, { ...row, authUserId })
    mark(label('recorded', index))
  }
}
