/** Per-flow Maestro budget for the native harness; the iOS first-flow gate keeps its fixed budget. */
import { flowTimeoutMs } from '../lib/story68-flow-timeouts.mjs'

export const OPEN_APP_FLOW = 'maestro/story65/open-app.yaml'

/**
 * open-app.yaml is the first flow of the iOS startup gate, so on iOS every run of it keeps one
 * fixed child budget the gate measures against. Other flows use their derived budget.
 *
 * Story 6.15 moved the iOS shards from macos-15 (Xcode 16.4, iOS 18.5 simulator) to macos-26
 * (Xcode 26.6, iOS 26.5 simulator) on the same 3-CPU, 7 GB host. The old 120000 ms had no
 * headroom even on iOS 18.5: the first open-app of 13 macos-15 shard jobs (2026-11-12 and 13)
 * took 47 to 118 s. On iOS 26.5 the simulator boots in 107 to 179 s instead of 64 to 93, and
 * the first open-app ran 80 s once and was killed at 120 s twice (dispatch 43371567368 shard 3,
 * push 43371494463 shard 1), each stopped in the dev-client open after Metro had served the
 * bundle; a later open-app took 102 s. 240000 ms is that 118 s worst case at the roughly 2x
 * iOS 26.5 slowdown with no further margin; a first flow over 192 s (80 percent) is a finding.
 */
export const IOS_FIRST_FLOW_TIMEOUT_MS = 240_000

export const NATIVE_PLATFORMS = ['android', 'ios']

/** Fails closed: a missing or unknown platform never falls through to the derived open-app budget. */
export function nativeFlowTimeoutMs(flow, platform) {
  const normalized = typeof platform === 'string' ? platform.trim().toLowerCase() : ''
  if (!NATIVE_PLATFORMS.includes(normalized))
    throw new Error('native_flow_platform_required')
  return normalized === 'ios' && flow === OPEN_APP_FLOW
    ? IOS_FIRST_FLOW_TIMEOUT_MS
    : flowTimeoutMs(flow)
}
