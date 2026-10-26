import { spawnSync } from 'node:child_process'

/** Keep both console and its adjacent ADB channel in the supported port range. */
export function assertOwnedStory68EmulatorPort({ avd, port }) {
  const value = Number(port)
  if (
    !['cc68-api32', 'cc68-api36'].includes(avd) ||
    typeof port !== 'string' ||
    !/^\d{4}$/.test(port) ||
    value < 5554 ||
    value > 5584 ||
    value % 2 !== 0
  )
    throw new Error('owned_avd_and_safe_even_port_required')
}

/** Reapply only idempotent forwards after one selected-device offline transition. */
export function restoreAndroidReverse({ adb, device, ports, execute = spawnSync }) {
  if (!device) throw new Error('explicit_device_required')
  const options = { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' }
  const fail = (result) =>
    new Error(
      `owned_command_failed:adb:${result.status}:${result.error?.code ?? String(result.stderr).slice(-1500)}`
    )
  const apply = () => {
    for (const port of ports) {
      const result = execute(
        adb,
        ['-s', device, 'reverse', `tcp:${port}`, `tcp:${port}`],
        options
      )
      if (result.status !== 0 || result.error) return result
    }
    return undefined
  }
  const first = apply()
  if (!first) return
  if (
    first.error ||
    first.status !== 1 ||
    String(first.stderr).trim() !== 'adb: device offline'
  )
    throw fail(first)
  const ready = execute(adb, ['-s', device, 'wait-for-device'], options)
  if (ready.status !== 0 || ready.error) throw fail(ready)
  const second = apply()
  if (second) throw fail(second)
}

/** Transport restoration never repeats a UI command or masks its failed result. */
export function withNativeTransport(invoke, restore) {
  restore()
  const result = invoke()
  try {
    restore()
  } catch (error) {
    if (result.status === 0) throw error
  }
  return result
}

/** Destructive app initialization is limited to the explicitly selected story test build. */
export function assertOwnedStory68AppReset({
  appId,
  isolatedBuild,
  debuggable,
  explicit,
}) {
  if (
    appId !== 'com.couturecast.story68' ||
    isolatedBuild !== '1' ||
    !debuggable ||
    explicit !== 'yes'
  )
    throw new Error('explicit_owned_story68_app_reinitialization_required')
}

/** Simulator evidence must prove that broad read access did not authorize the import. */
export function assertIosReadDenied(state, requireAddOnly = false) {
  if (state.read !== 0 || (requireAddOnly && state.addOnly !== 2))
    throw new Error('ios_read_denied_add_only_evidence_required')
}

export function shouldRetryIosSnapshot({ platform, attempt, log, flow }) {
  const signature =
    'Snapshot failure while getting view hierarchy. Error: Error getting element frame kAXErrorInvalidUIElement'
  const terminal = log
    .split('\n')
    .filter((line) => line.includes('[ERROR]'))
    .at(-1)
  const ordinaryFailure =
    /AssertionFailure|AssertionFailed|Assertion is false/.test(log) ||
    [...log.matchAll(/CommandFailed: ([^\r\n]*)/g)].some((match) => match[1] !== 'null')
  return (
    platform === 'ios' &&
    [
      'maestro/story68/community-draft-background-ios.yaml',
      'maestro/story68/open-outfit.yaml',
      'maestro/story68/open-post.yaml',
      'maestro/story68/cancel.yaml',
    ].includes(flow) &&
    attempt === 0 &&
    log.includes(signature) &&
    (!terminal ||
      terminal.includes(signature) ||
      terminal.includes('CommandFailed: null')) &&
    !ordinaryFailure
  )
}
