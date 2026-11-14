// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 (Antigravity r21): one bounded, checked spawnSync for the Test Store driver's
// side calls (git rev-parse, uninstall, force-stop, terminate). A call killed at its bound comes
// back with result.error ETIMEDOUT; carrying on would turn an uninstall into an in-place upgrade,
// leave the old app running, or record an empty build rev. So a spawn error always throws the
// call's code; a nonzero exit throws too unless the call tolerates it (uninstall of an app that is
// not installed, terminate of an app that is not running).
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { JourneyError } from './test-store-journey.mjs'

export const SPAWN_TIMEOUT_MS = 30_000

/**
 * A spawn bound in milliseconds: a positive safe integer, given as a number or the text of one.
 * 0 would turn the bound off and text such as `abc` would reach spawnSync as NaN (Antigravity
 * r22), so anything else throws test_store_spawn_timeout_invalid.
 */
export function boundOf(value) {
  const ms = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms <= 0)
    throw new JourneyError('test_store_spawn_timeout_invalid', String(value))
  return ms
}

export function boundedSpawn(
  binary,
  args,
  { code, tolerateStatus = false, timeout = SPAWN_TIMEOUT_MS, ...options }
) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    ...options,
    timeout: boundOf(timeout),
    killSignal: 'SIGKILL',
  })
  const call = `${path.basename(binary)} ${args.slice(0, 2).join(' ')}`
  if (result.error)
    throw new JourneyError(code, `${call}: ${result.error.code ?? 'spawn_error'}`)
  if (!tolerateStatus && result.status !== 0)
    throw new JourneyError(code, `${call}: exit ${result.status ?? result.signal}`)
  return result
}
