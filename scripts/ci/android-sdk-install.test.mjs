// Story 6.14 follow-up: the mobile e2e SDK install cannot stall the job. In run
// 43083368586 one sdkmanager call ran 33.5 minutes and the shard hit its job timeout.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../../', import.meta.url))
const workflow = parse(
  readFileSync(path.join(root, '.github/workflows/pr-mobile-e2e.yml'), 'utf8')
)
const step = workflow.jobs['mobile-e2e-android'].steps.find(
  (candidate) => candidate.name === 'Install Android SDK packages for the emulator'
)

test('the SDK install step has its own timeout', () => {
  assert.ok(step['timeout-minutes'] > 0 && step['timeout-minutes'] <= 8)
})

test('an sdkmanager call that stalls is cut off and the next attempt installs', (t) => {
  const work = mkdtempSync(path.join(os.tmpdir(), 'sdk-install-'))
  t.after(() => rmSync(work, { recursive: true, force: true }))
  const bin = path.join(work, 'bin')
  const sdk = path.join(work, 'sdk')
  mkdirSync(bin)
  mkdirSync(sdk)
  // GNU timeout's contract with every limit scaled by 1/60, signalling the whole group.
  writeFileSync(
    path.join(bin, 'timeout'),
    `#!/bin/bash
while [[ "$1" == --* ]]; do shift; done
seconds=$(awk -v s="$1" 'BEGIN { v = s / 60; print (v < 1 ? 1 : v) }'); shift
marker="$(mktemp)"; rm -f "$marker"
set -m; "$@" & child=$!; set +m
( /bin/sleep "$seconds"; touch "$marker"; kill -KILL -- "-$child" 2> /dev/null ) < /dev/null > /dev/null 2>&1 &
watcher=$!
wait "$child"; status=$?
kill "$watcher" 2> /dev/null
if [ -e "$marker" ]; then rm -f "$marker"; exit 124; fi
exit "$status"
`,
    { mode: 0o755 }
  )
  // The first call stalls; later calls unpack the package (its package.xml appears).
  writeFileSync(
    path.join(bin, 'sdkmanager'),
    `#!/bin/bash
package="\${2}"
if [ ! -e "${work}/stalled-once" ]; then touch "${work}/stalled-once"; exec /bin/sleep 600; fi
mkdir -p "$ANDROID_HOME/\${package//;//}" && touch "$ANDROID_HOME/\${package//;//}/package.xml"
`,
    { mode: 0o755 }
  )
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 })
  const started = Date.now()
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run],
    {
      encoding: 'utf8',
      timeout: 20_000,
      killSignal: 'SIGKILL',
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        ANDROID_HOME: sdk,
        SDK_PACKAGES: 'platform-tools emulator',
      },
    }
  )
  assert.equal(
    result.signal,
    null,
    `the install was still running after 20 s:\n${result.stdout}`
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(Date.now() - started < 15_000)
  assert.match(
    result.stdout,
    /Install attempt 1 of platform-tools left nothing behind; retrying/
  )
  assert.match(result.stdout, /Installed platform-tools/)
  assert.match(result.stdout, /Installed emulator/)
})
