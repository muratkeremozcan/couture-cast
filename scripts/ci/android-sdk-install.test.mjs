// Story 6.14 follow-up: the Android SDK install cannot stall a job. In run 43083368586 one
// sdkmanager call ran 33.5 minutes and the shard hit its job timeout. The emulator jobs
// (pr-mobile-e2e.yml) and every Gradle build of the app (android-gradle-sdk-workflows.test.mjs)
// install through scripts/ci/android-sdk-install.sh, so these cases drive that script.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../../', import.meta.url))
const script = path.join(root, 'scripts/ci/android-sdk-install.sh')
const workflow = parse(
  readFileSync(path.join(root, '.github/workflows/pr-mobile-e2e.yml'), 'utf8')
)
const step = workflow.jobs['mobile-e2e-android'].steps.find(
  (candidate) => candidate.name === 'Install Android SDK packages for the emulator'
)

test('the emulator SDK step has its own timeout', () => {
  assert.ok(step['timeout-minutes'] > 0 && step['timeout-minutes'] <= 8)
})

test('the emulator SDK step installs its list through the shared script', () => {
  assert.equal(step.run.trim(), 'bash scripts/ci/android-sdk-install.sh')
  assert.match(step.env.SDK_PACKAGES, /^build-tools;\S+ platform-tools /)
  assert.match(
    step.env.SDK_PACKAGES,
    / system-images;android-\$\{\{ env\.ANDROID_API_LEVEL \}\};/
  )
  assert.match(step.env.SDK_PACKAGES, / emulator$/)
})

/** Runs the script against a stub sdkmanager; `sdkmanager` is its bash body. */
function runStep(t, sdkmanager, env = {}, args = [], { node } = {}) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'sdk-install-'))
  t.after(() => rmSync(work, { recursive: true, force: true }))
  const bin = path.join(work, 'bin')
  const sdk = path.join(work, 'sdk')
  mkdirSync(bin)
  mkdirSync(sdk)
  writeFileSync(
    path.join(bin, 'timeout'),
    '#!/bin/bash\nwhile [[ "$1" == --* ]]; do shift; done\nshift\nexec "$@"\n',
    { mode: 0o755 }
  )
  writeFileSync(
    path.join(bin, 'sdkmanager'),
    `#!/bin/bash\npackage="\${2}"\ncalls="${work}/calls"\necho x >> "$calls"\nn=$(wc -l < "$calls")\n${sdkmanager}\n`,
    { mode: 0o755 }
  )
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 })
  // The package resolver of --gradle, standing in for node.
  if (node !== undefined)
    writeFileSync(path.join(bin, 'node'), `#!/bin/bash\n${node}\n`, { mode: 0o755 })
  const home = path.join(work, 'home')
  mkdirSync(home)
  const result = spawnSync('bash', ['--noprofile', '--norc', script, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
    env: { PATH: `${bin}:/usr/bin:/bin`, ANDROID_HOME: sdk, HOME: home, ...env },
  })
  const properties = path.join(home, '.gradle/gradle.properties')
  return {
    ...result,
    sdk,
    gradleProperties: existsSync(properties) ? readFileSync(properties, 'utf8') : null,
  }
}

const unpack =
  'mkdir -p "$ANDROID_HOME/${package//;//}" && touch "$ANDROID_HOME/${package//;//}/package.xml"'

test('a package that fails five times installs on the sixth attempt', (t) => {
  const result = runStep(
    t,
    `if [ "$n" -le 5 ]; then echo "Warning: An error occurred while preparing SDK package: download failed ($n)"; exit 1; fi\n${unpack}`,
    { SDK_PACKAGES: 'system-images;android-34;google_apis;x86_64' }
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stdout.match(/left nothing behind; sdkmanager said:/g).length, 5)
  assert.match(result.stdout, /Installed system-images;android-34;google_apis;x86_64\n/)
})

test('a failed attempt prints what sdkmanager said', (t) => {
  const result = runStep(
    t,
    `if [ "$n" -eq 1 ]; then echo "Warning: An error occurred while preparing SDK package: Error on ZipFile unknown archive"; exit 1; fi\n${unpack}`,
    { SDK_PACKAGES: 'emulator' }
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(
    result.stdout.includes(
      'Install attempt 1 of emulator left nothing behind; sdkmanager said:\n  | Warning: An error occurred while preparing SDK package: Error on ZipFile unknown archive\n'
    ),
    result.stdout
  )
})

test('a package that never installs fails after six attempts with an error', (t) => {
  const result = runStep(t, 'echo "Warning: still failing"; exit 1', {
    SDK_PACKAGES: 'emulator',
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout.match(/left nothing behind/g).length, 6)
  assert.match(result.stdout, /::error::Could not install emulator after 6 attempts\.\n$/)
})

test('the install budget stops new attempts once it runs out', (t) => {
  const result = runStep(t, 'echo "Warning: still failing"; exit 1', {
    SDK_PACKAGES: 'emulator',
    SDK_INSTALL_BUDGET_SECONDS: '10',
  })
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stdout, /left nothing behind/)
  assert.match(
    result.stdout,
    /::error::Could not install emulator: the 10 s install budget ran out after 0 attempts\.\n$/
  )
})

test('a retry whose backoff would overrun the budget stops before sleeping', (t) => {
  const result = runStep(t, 'echo "Warning: still failing"; exit 1', {
    SDK_PACKAGES: 'emulator',
    SDK_INSTALL_BUDGET_SECONDS: '30',
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout.match(/left nothing behind/g).length, 1)
  assert.match(
    result.stdout,
    /::error::Could not install emulator: the 30 s install budget ran out after 1 attempts\.\n$/
  )
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
  const result = spawnSync('bash', ['--noprofile', '--norc', script], {
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      ANDROID_HOME: sdk,
      SDK_PACKAGES: 'platform-tools emulator',
    },
  })
  assert.equal(
    result.signal,
    null,
    `the install was still running after 20 s:\n${result.stdout}`
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(Date.now() - started < 15_000)
  assert.match(
    result.stdout,
    /Install attempt 1 of platform-tools left nothing behind; sdkmanager said:\n/
  )
  assert.match(result.stdout, /Installed platform-tools/)
  assert.match(result.stdout, /Installed emulator/)
})

// Main run 43927343722: Gradle fetched NDK 27.1.12297006 itself, dl.google.com answered 429 and
// android36-controls failed. --gradle installs what the build needs first, with the same retries.
const gradlePackages =
  'ndk;27.1.12297006 cmake;3.22.1 build-tools;36.0.0 platforms;android-36'

test('--gradle installs every resolved package through a run of 429s', (t) => {
  const result = runStep(
    t,
    `if [ "$package" = "ndk;27.1.12297006" ] && [ "$n" -le 3 ]; then echo "Warning: Failed to download package: HTTP 429 Too Many Requests"; exit 1; fi\n${unpack}`,
    {},
    ['--gradle'],
    { node: `echo '${gradlePackages}'` }
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(
    result.stdout.match(/Install attempt \d of ndk;27\.1\.12297006 left nothing behind/g)
      .length,
    3
  )
  for (const installed of gradlePackages.split(' ')) {
    assert.match(
      result.stdout,
      new RegExp(`Installed ${installed.replace(/[.;]/g, '\\$&')}\n`)
    )
    assert.ok(
      existsSync(path.join(result.sdk, installed.replaceAll(';', '/'), 'package.xml')),
      installed
    )
  }
  // Nothing missing from the list may be downloaded mid-build any more.
  assert.equal(result.gradleProperties, 'android.builder.sdkDownload=false\n')
})

test('--gradle leaves Gradle downloads alone when a package never installs', (t) => {
  const result = runStep(t, 'echo "Warning: HTTP 429"; exit 1', {}, ['--gradle'], {
    node: `echo '${gradlePackages}'`,
  })
  assert.equal(result.status, 1)
  assert.match(
    result.stdout,
    /::error::Could not install ndk;27\.1\.12297006 after 6 attempts\.\n$/
  )
  assert.equal(result.gradleProperties, null)
})

test('--gradle fails when the packages cannot be resolved', (t) => {
  const result = runStep(t, unpack, {}, ['--gradle'], {
    node: 'echo "android_sdk_packages_missing_version: ndkVersion" >&2; exit 1',
  })
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stdout, /Installed/)
  assert.equal(result.gradleProperties, null)
})

test('a run with no packages to install fails instead of passing empty', (t) => {
  const result = runStep(t, unpack, { SDK_PACKAGES: '' })
  assert.equal(result.status, 2)
  assert.match(result.stdout, /::error::No Android SDK packages to install\./)
})
