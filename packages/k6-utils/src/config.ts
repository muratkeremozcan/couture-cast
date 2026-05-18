// Environment-aware config loader using k6's SharedArray and open().
// Reads a JSON config file (default: configs/dev.json) set via TEST_CONFIG env var.
// Supports QPS, DURATION, and VUS env var overrides with safety caps.
// Must be called at module scope (init phase) — k6's open() is unavailable inside default/setup/teardown.

// note: k6 runs each VU (virtual user) in its own JS runtime. Without SharedArray,
// if 100 VUs call getConfig(), you get 100 copies of the same config object in memory.
//  SharedArray creates one copy shared across all VUs (read-only).
// The "config" string is the cache key — second call with same name returns the same instance, no re-parsing.

import { SharedArray } from 'k6/data'
import type { Options, Scenario } from 'k6/options'

// Mutable scenario — k6's Scenario is a strict discriminated union that prevents
// field-level mutation. This type allows applyEnvOverrides to set rate/duration/VUs
// on any executor shape without TS complaining about the union mismatch.
type MutableScenario = Record<string, unknown>

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function parsePositiveInt(value: string, name: string): number {
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n <= 0)
    throw new Error(`${name} must be a positive integer, got: "${value}"`)
  return n
}

// Hard ceiling for VUs to prevent runner memory exhaustion. Override via MAX_VUS env var.
const MAX_VUS = parsePositiveInt(__ENV.MAX_VUS || '2000', 'MAX_VUS')
// How many seconds a VU might be busy per request. Used to auto-scale VUs from QPS.
// Override via VU_PER_QPS env var if your service is faster/slower than 6s.
// Example: fast service (200ms) -> VU_PER_QPS=1, slow service (10s) -> VU_PER_QPS=10
const VU_PER_QPS = parsePositiveInt(__ENV.VU_PER_QPS || '6', 'VU_PER_QPS')

/**
 * Loads and caches the test config JSON. Reads `TEST_CONFIG` env var for the file path.
 * @returns k6 Options object parsed from the config JSON
 */
export function getConfig(): Options {
  // 'configs/dev.json' is an intentional non-existent fallback — all real entry points
  // (run-k6-env.sh, CI workflows) always set TEST_CONFIG. If you hit a "file not found"
  // error here, TEST_CONFIG was not passed to k6.
  const configPath = __ENV.TEST_CONFIG || 'configs/dev.json'
  const data = new SharedArray<Options>('config', () => [
    JSON.parse(open(configPath)) as Options,
  ])
  return data[0] as Options
}

/**
 * Applies QPS, DURATION, and VUS env var overrides to the loaded config.
 * QPS also auto-scales preAllocatedVUs (VU = QPS * VU_PER_QPS, capped at MAX_VUS).
 * Call after `getConfig()` to merge overrides into a scenario block.
 * Note: returns a new object; the original config is not mutated.
 * @returns a new Options object with overrides applied
 */
export function applyEnvOverrides(config: Options): Options {
  // Deep-clone to avoid mutating SharedArray-backed or caller-owned objects
  const cloned = JSON.parse(JSON.stringify(config)) as Options

  // Only applies to the first scenario in the config
  const scenarios = cloned.scenarios as Record<string, MutableScenario> | undefined
  if (!scenarios) return cloned

  const scenarioKeys = Object.keys(scenarios)
  const scenarioName = scenarioKeys[0]
  if (!scenarioName) return cloned

  // Warn when multiple scenarios exist, since overrides only target the first
  const hasEnvOverrides = __ENV.QPS || __ENV.DURATION || __ENV.VUS
  if (scenarioKeys.length > 1 && hasEnvOverrides) {
    console.warn(
      `applyEnvOverrides: config has ${scenarioKeys.length} scenarios but env overrides (QPS/DURATION/VUS) only apply to the first scenario ("${scenarioName}").`
    )
  }

  const scenario = scenarios[scenarioName]!
  const executor = scenario.executor as string | undefined

  // Detect executor type to write the correct VU field
  const isArrivalRate =
    executor === 'constant-arrival-rate' || executor === 'ramping-arrival-rate'

  // QPS only makes sense for arrival-rate executors (sets the "rate" field).
  // For VU-based executors, QPS is ignored with a warning.
  if (__ENV.QPS) {
    if (!isArrivalRate) {
      console.warn(
        `QPS override ignored: executor "${executor}" is not an arrival-rate executor`
      )
    } else {
      const qps = parsePositiveInt(__ENV.QPS, 'QPS')
      if (qps > MAX_VUS) throw new Error(`QPS cannot be greater than ${MAX_VUS}`)
      const vus = Math.min(MAX_VUS, qps * VU_PER_QPS)
      scenario.rate = qps // how many requests per second k6 tries to send
      scenario.preAllocatedVUs = vus // how many VUs are ready to send them
    }
  }

  if (__ENV.DURATION) {
    if (executor === 'ramping-arrival-rate') {
      console.warn(
        'DURATION override ignored: ramping-arrival-rate uses "stages" to control duration, not a single "duration" field. Adjust stages in your config JSON instead.'
      )
    } else {
      scenario.duration = __ENV.DURATION
    }
  }

  // VUS writes the correct field based on executor type:
  //   arrival-rate executors: preAllocatedVUs (pool of VUs available to sustain the rate)
  //   VU-based executors: vus (how many VUs run concurrently)
  if (__ENV.VUS) {
    const vus = parsePositiveInt(__ENV.VUS, 'VUS')
    if (vus > MAX_VUS) throw new Error(`VUS cannot be greater than ${MAX_VUS}`)
    if (isArrivalRate) {
      scenario.preAllocatedVUs = vus
    } else {
      scenario.vus = vus
    }
  }

  return cloned
}

/**
 * Builds a multi-scenario config by cloning the first scenario block for each named function.
 * Each clone gets `exec` set to the scenario name, so k6 calls the matching exported function.
 * @param scenarioNames - Array of exported function names in your test script
 * @example getScenarioConfig(['testLogin', 'testSearch'], applyEnvOverrides(getConfig()))
 * // creates two scenarios sharing the same base executor settings
 * @returns k6 Options with cloned scenarios, each with exec set to the function name
 */
export function getScenarioConfig(
  scenarioNames: string[],
  config: Options = getConfig()
): Options {
  const scenarios = config.scenarios as Record<string, Scenario> | undefined
  const baseScenario = scenarios ? Object.values(scenarios)[0] : undefined

  const result: Record<string, Scenario> = {}
  for (const name of scenarioNames) {
    if (baseScenario) {
      result[name] = { ...cloneJson(baseScenario), exec: name } as Scenario
    }
  }

  // Preserve the full config (thresholds, etc.); only replace scenarios
  return { ...config, scenarios: result }
}

/** Reads an env var with a fallback value. Convenience wrapper over `__ENV`. */
export function getEnvOverride(key: string, fallback: string): string {
  return __ENV[key] || fallback
}
