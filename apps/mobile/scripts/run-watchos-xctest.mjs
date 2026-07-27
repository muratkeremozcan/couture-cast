import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  createExpoPrebuildWorkspace,
  mobileRoot,
  runExpoPrebuild,
} = require('../plugins/prebuild-test-helpers')

if (process.platform !== 'darwin') {
  throw new Error('watchOS XCTest execution requires macOS')
}

const artifactRoot = path.resolve(
  mobileRoot,
  process.env.WATCHOS_ARTIFACT_DIR ?? 'artifacts/watchos'
)
if (artifactRoot === mobileRoot || !artifactRoot.startsWith(`${mobileRoot}${path.sep}`)) {
  throw new Error('WATCHOS_ARTIFACT_DIR must resolve inside apps/mobile')
}

fs.mkdirSync(artifactRoot, { recursive: true })
const logPath = path.join(artifactRoot, 'xcodebuild.log')
const runtimeInventoryPath = path.join(artifactRoot, 'simulator-runtimes.json')
const deviceInventoryPath = path.join(artifactRoot, 'simulator-devices.json')
const burnInCount = Number.parseInt(process.env.WATCHOS_BURN_IN_COUNT ?? '10', 10)
if (!Number.isInteger(burnInCount) || burnInCount < 1 || burnInCount > 10) {
  throw new Error('WATCHOS_BURN_IN_COUNT must be an integer from 1 through 10')
}
const resultBundlePaths = Array.from({ length: burnInCount }, (_, index) =>
  path.join(artifactRoot, `WatchAppTests-iteration-${index + 1}.xcresult`)
)
fs.writeFileSync(logPath, '')
for (const resultBundlePath of resultBundlePaths) {
  fs.rmSync(resultBundlePath, { recursive: true, force: true })
}

function appendLog(value) {
  fs.appendFileSync(logPath, value.endsWith('\n') ? value : `${value}\n`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? mobileRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    timeout: options.timeout ?? 120_000,
  })
  appendLog(`$ ${command} ${args.join(' ')}`)
  appendLog(result.stdout ?? '')
  appendLog(result.stderr ?? '')
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `${options.label ?? command} failed with status ${String(result.status)}`
    )
  }
  return result.stdout ?? ''
}

function parseJson(command, args, options) {
  return JSON.parse(run(command, args, options))
}

function availableWatchRuntimes() {
  const inventory = parseJson('xcrun', ['simctl', 'list', '-j', 'runtimes'], {
    label: 'watchOS runtime inventory',
  })
  fs.writeFileSync(runtimeInventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)
  return inventory.runtimes
    .filter(
      (runtime) =>
        runtime.identifier.includes('SimRuntime.watchOS') && runtime.isAvailable !== false
    )
    .sort((left, right) =>
      right.version.localeCompare(left.version, undefined, { numeric: true })
    )
}

function resolveWatchRuntime() {
  let runtimes = availableWatchRuntimes()
  if (runtimes.length === 0 && process.env.WATCHOS_ALLOW_RUNTIME_DOWNLOAD === '1') {
    run('xcodebuild', ['-downloadPlatform', 'watchOS'], {
      label: 'watchOS runtime download',
      timeout: 20 * 60_000,
    })
    runtimes = availableWatchRuntimes()
  }
  if (runtimes.length === 0) {
    throw new Error(
      'No available watchOS simulator runtime. Install one in Xcode or set ' +
        'WATCHOS_ALLOW_RUNTIME_DOWNLOAD=1.'
    )
  }
  return runtimes[0]
}

function resolveWatchDevice(runtime) {
  const deviceTypes = runtime.supportedDeviceTypes.filter(
    (deviceType) =>
      deviceType.productFamily?.toLowerCase() === 'apple watch' ||
      deviceType.identifier.includes('Apple-Watch')
  )
  const preferredType =
    deviceTypes.find((deviceType) => deviceType.name.includes('Series 10 (42mm)')) ??
    deviceTypes[0]
  if (!preferredType) {
    throw new Error('No Apple Watch simulator device type is installed')
  }

  const inventory = parseJson('xcrun', ['simctl', 'list', '-j', 'devices'], {
    label: 'watchOS device inventory',
  })
  fs.writeFileSync(deviceInventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)
  const existing = (inventory.devices[runtime.identifier] ?? []).find(
    (device) => device.isAvailable !== false
  )
  if (existing) {
    return {
      udid: existing.udid,
      created: false,
      wasBooted: existing.state === 'Booted',
    }
  }

  const name = `CoutureCast Watch Tests ${String(process.pid)}`
  const udid = run(
    'xcrun',
    ['simctl', 'create', name, preferredType.identifier, runtime.identifier],
    { label: 'watchOS simulator creation' }
  ).trim()
  return { udid, created: true, wasBooted: false }
}

function captureFailureScreenshot(udid) {
  const screenshotPath = path.join(artifactRoot, 'watch-failure.png')
  const result = spawnSync(
    'xcrun',
    ['simctl', 'io', udid, 'screenshot', screenshotPath],
    { encoding: 'utf8', timeout: 30_000 }
  )
  appendLog(result.stdout ?? '')
  appendLog(result.stderr ?? '')
}

function writeResultSummary(resultBundlePath, iteration) {
  if (!fs.existsSync(resultBundlePath)) {
    return
  }
  const result = spawnSync(
    'xcrun',
    [
      'xcresulttool',
      'get',
      'test-results',
      'summary',
      '--path',
      resultBundlePath,
      '--format',
      'json',
    ],
    { encoding: 'utf8', timeout: 60_000 }
  )
  fs.writeFileSync(
    path.join(artifactRoot, `xcresult-summary-iteration-${iteration}.json`),
    result.status === 0 ? result.stdout : '{}\n'
  )
  if (result.stderr) {
    fs.writeFileSync(
      path.join(artifactRoot, `xcresult-summary-iteration-${iteration}-error.log`),
      result.stderr
    )
  }
}

const workspace = createExpoPrebuildWorkspace({
  prefix: 'couture-watchos-xctest-',
})
let device

try {
  run('xcodebuild', ['-version'], { label: 'Xcode version' })
  run('xcrun', ['--sdk', 'watchsimulator', '--show-sdk-version'], {
    label: 'watchOS SDK version',
  })

  const prebuild = runExpoPrebuild(workspace.root, {
    platform: 'ios',
    timeout: 90_000,
  })
  appendLog(prebuild.stdout ?? '')
  appendLog(prebuild.stderr ?? '')
  if (prebuild.error) {
    throw prebuild.error
  }
  if (prebuild.status !== 0) {
    throw new Error(`Expo prebuild failed with status ${String(prebuild.status)}`)
  }

  const runtime = resolveWatchRuntime()
  appendLog(`Selected runtime: ${runtime.name} (${runtime.identifier})`)
  device = resolveWatchDevice(runtime)
  appendLog(`Selected device: ${device.udid}`)

  if (!device.wasBooted) {
    const boot = spawnSync('xcrun', ['simctl', 'boot', device.udid], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (boot.status !== 0 && !boot.stderr?.includes('Unable to boot device')) {
      appendLog(boot.stderr ?? '')
      throw new Error('watchOS simulator boot failed')
    }
  }
  run('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], {
    label: 'watchOS simulator boot status',
    timeout: 180_000,
  })

  for (const [index, resultBundlePath] of resultBundlePaths.entries()) {
    const iteration = index + 1
    appendLog(`watchOS burn-in iteration ${iteration}/${burnInCount}`)
    run(
      'xcodebuild',
      [
        '-project',
        path.join(workspace.root, 'ios/CoutureCast.xcodeproj'),
        '-scheme',
        'WatchAppTests',
        '-configuration',
        'Debug',
        '-destination',
        `platform=watchOS Simulator,id=${device.udid}`,
        '-derivedDataPath',
        path.join(workspace.root, 'build/derived-data'),
        '-resultBundlePath',
        resultBundlePath,
        '-resultBundleVersion',
        '3',
        '-destination-timeout',
        '120',
        '-enableCodeCoverage',
        'YES',
        '-parallel-testing-enabled',
        'NO',
        '-maximum-concurrent-test-simulator-destinations',
        '1',
        '-test-timeouts-enabled',
        'YES',
        '-default-test-execution-time-allowance',
        '120',
        '-maximum-test-execution-time-allowance',
        '300',
        '-collect-test-diagnostics',
        'on-failure',
        '-showBuildTimingSummary',
        'CODE_SIGNING_ALLOWED=NO',
        'CODE_SIGNING_REQUIRED=NO',
        'COMPILER_INDEX_STORE_ENABLE=NO',
        'test',
      ],
      {
        label: `watchOS XCTest burn-in iteration ${iteration}`,
        timeout: 12 * 60_000,
      }
    )
    writeResultSummary(resultBundlePath, iteration)
  }
} catch (error) {
  if (device?.udid) {
    captureFailureScreenshot(device.udid)
  }
  appendLog(error instanceof Error ? (error.stack ?? error.message) : String(error))
  throw error
} finally {
  for (const [index, resultBundlePath] of resultBundlePaths.entries()) {
    writeResultSummary(resultBundlePath, index + 1)
  }
  if (device && !device.wasBooted) {
    spawnSync('xcrun', ['simctl', 'shutdown', device.udid], {
      encoding: 'utf8',
      timeout: 30_000,
    })
  }
  if (device?.created) {
    spawnSync('xcrun', ['simctl', 'delete', device.udid], {
      encoding: 'utf8',
      timeout: 30_000,
    })
  }
  workspace.cleanup()
}
