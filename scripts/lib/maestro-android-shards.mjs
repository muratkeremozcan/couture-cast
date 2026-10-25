/**
 * Story 6.7b R21: an Android run across several devices gives every device its
 * own Maestro invocation per flow, with the serial path's flow cap and launch
 * watchdog, on its own pinned driver port.
 *
 * Before R21 the shardable flows ran as one `maestro test --shard-split N`
 * process for every device. It had no flow cap and no launch stall check, so a
 * `launchApp` stuck on one device held the whole run, and killing that process
 * would have stopped the other devices' flows with it. One process also cannot
 * pin a driver port: `--driver-host-port` is one number for every device, so the
 * R18 port fix had to leave that path on Maestro's random host-ephemeral port.
 *
 * Here each device works through its own queue, the queues run side by side, and
 * a stalled launch kills only that device's current flow; every queue then
 * moves on to its next flow. Device N (from 0) pins its driver to
 * `MAESTRO_ANDROID_DRIVER_PORT + N`. Flows are spread longest first by their
 * recorded durations, the same packing `resolve-maestro-shard.mjs` uses for CI.
 * iOS keeps Maestro's own `--shard-split`; the R18 launch watchdog is Android only.
 */
import path from 'node:path'
import { MAESTRO_ANDROID_DRIVER_PORT } from './maestro-android-driver-session.mjs'
import { withTestOptions } from './maestro-driver-reuse.mjs'
import { runMobileE2EFlow } from './mobile-e2e-flow-retry.mjs'

/**
 * Spreads `flows` over `devices`, longest recorded duration first, each into the
 * device with the least work so far (the first such device on a tie). A flow
 * with no recorded duration counts as the mean of the recorded ones. Each
 * device keeps its flows in the order they were given.
 *
 * @param {readonly string[]} flows
 * @param {readonly string[]} devices
 * @param {Record<string, number>} durations seconds, keyed by flow file name
 * @returns {Map<string, string[]>}
 */
export function assignFlowsToDevices(flows, devices, durations = {}) {
  if (devices.length === 0) throw new Error('No device to run the flows on')
  const known = Object.entries(durations)
    .filter(([name, seconds]) => !name.startsWith('_') && typeof seconds === 'number')
    .map(([, seconds]) => seconds)
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1
  const cost = (flow) => {
    const seconds = durations[path.basename(flow)]
    return typeof seconds === 'number' ? seconds : fallback
  }
  const totals = devices.map(() => 0)
  /** @type {Set<string>[]} */
  const chosen = devices.map(() => new Set())
  const byCost = flows
    .map((flow, order) => ({ flow, order, seconds: cost(flow) }))
    .sort((left, right) => right.seconds - left.seconds || left.order - right.order)
  for (const { flow, seconds } of byCost) {
    const index = totals.indexOf(Math.min(...totals))
    totals[index] += seconds
    chosen[index].add(flow)
  }
  return new Map(
    devices.map((device, index) => [
      device,
      flows.filter((flow) => chosen[index].has(flow)),
    ])
  )
}

/**
 * Runs `flows` across `devices`: one queue per device, all queues at once, one
 * Maestro invocation per flow. For every flow the queue prepares the device's
 * driver on its pinned port and builds that device's arguments, then starts
 * Maestro through `runMaestro` with the flow cap (`timeoutMs`) and, for every
 * attempt, a fresh launch stall check (`stallCheck`). A flow killed at the cap
 * gets the serial path's single retry; a launch-stall kill does not
 * (`runMobileE2EFlow`). A flow whose driver cannot be prepared is refused with
 * the cause, and its queue moves on, as it does after a failed or stalled flow.
 *
 * @typedef {{ intervalMs: number, check: () => Promise<string | undefined> }} StallCheck
 * @param {{
 *   flows: readonly string[],
 *   devices: readonly string[],
 *   durations?: Record<string, number>,
 *   timeoutMs: number,
 *   prepareDriver: (device: string, driverPort: number) => Promise<string[]>,
 *   buildArgs: (flowPath: string, device: string) => string[],
 *   spawnOptionsFor: (flowPath: string, device: string) => object,
 *   stallCheckFor: (flowPath: string, device: string) =>
 *     ((attemptStartedAtMs: number) => StallCheck) | undefined,
 *   runMaestro: (args: string[], options: { timeoutMs: number, stallCheck?: StallCheck }) => Promise<void>,
 *   beforeAttempt?: (args: string[]) => void,
 *   onRetry?: (flowPath: string, device: string, error: Error) => void,
 *   recordInvocation: (device: string) => void,
 *   onRefused: (flowPath: string, device: string, cause: string) => void,
 *   onFinished: (flowPath: string, device: string, error: Error | undefined, startedAtMs: number) => void,
 *   log: (message: string) => void,
 *   now?: () => number,
 * }} options
 * @returns {Promise<Map<string, string[]>>} the flows each device ran
 */
export async function runAndroidDeviceShards({
  flows,
  devices,
  durations = {},
  timeoutMs,
  prepareDriver,
  buildArgs,
  spawnOptionsFor,
  stallCheckFor,
  runMaestro,
  beforeAttempt = () => undefined,
  onRetry = () => undefined,
  recordInvocation,
  onRefused,
  onFinished,
  log,
  now = Date.now,
}) {
  const assignments = assignFlowsToDevices(flows, devices, durations)
  await Promise.all(
    devices.map(async (device, index) => {
      const driverPort = MAESTRO_ANDROID_DRIVER_PORT + index
      const queue = assignments.get(device) ?? []
      log(
        `[${device}] ${queue.length} flow(s) on driver port ${driverPort}: ${queue.join(', ')}`
      )
      for (const flowPath of queue) {
        let driverArgs
        try {
          // eslint-disable-next-line no-await-in-loop -- one flow at a time per device
          driverArgs = await prepareDriver(device, driverPort)
        } catch (error) {
          onRefused(
            flowPath,
            device,
            error instanceof Error ? error.message : String(error)
          )
          continue
        }
        const args = withTestOptions(buildArgs(flowPath, device), driverArgs)
        const stallCheckForAttempt = stallCheckFor(flowPath, device)
        const startedAtMs = now()
        /** @type {Error | undefined} */
        let failure
        try {
          // eslint-disable-next-line no-await-in-loop -- one flow at a time per device
          await runMobileE2EFlow({
            run: () => {
              beforeAttempt(args)
              const stallCheck = stallCheckForAttempt?.(now())
              return runMaestro(args, {
                ...spawnOptionsFor(flowPath, device),
                timeoutMs,
                ...(stallCheck ? { stallCheck } : {}),
              })
            },
            // Shardable flows share no per-flow fixture, as under `--shard-split`.
            reset: () => Promise.resolve(),
            onRetry: (error) => onRetry(flowPath, device, error),
          })
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error))
        }
        recordInvocation(device)
        onFinished(flowPath, device, failure, startedAtMs)
      }
    })
  )
  return assignments
}
