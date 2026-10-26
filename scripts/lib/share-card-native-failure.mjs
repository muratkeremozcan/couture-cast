import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const flows = new Map([['maestro/share-card-export.yaml', 'share-card-export.yaml']])
for (const story of ['story65', 'story68']) {
  const directory = new URL(`../../maestro/${story}/`, import.meta.url)
  for (const entry of fs.readdirSync(fileURLToPath(directory), { withFileTypes: true })) {
    if (entry.isFile() && /^[a-z][a-z0-9-]*\.yaml$/.test(entry.name)) {
      flows.set(`maestro/${story}/${entry.name}`, entry.name)
    }
  }
}
const basenames = new Set(flows.values())
const classifications = new Set([
  'snapshot',
  'elementtimeout',
  'driverconnection',
  'assertion',
  'unknown',
])
const keys = ['classification', 'durationMs', 'flow', 'platform']
const invalid = () => {
  throw new Error('invalid_native_flow_failure')
}
const validDuration = (value) => Number.isSafeInteger(value) && value >= 0
const validPlatform = (value) => value === 'android' || value === 'ios'

/** Validate the entire public record before any evidence is copied. */
export function assertNativeFlowFailure(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys.join(',') ||
    !basenames.has(value.flow) ||
    !classifications.has(value.classification) ||
    !validDuration(value.durationMs) ||
    !validPlatform(value.platform)
  ) {
    invalid()
  }
}

/** Raw Maestro output is used only for matching fixed signatures in memory. */
export function summarizeNativeFlowFailure({ flow, platform, durationMs, log }) {
  if (
    !flows.has(flow) ||
    !validPlatform(platform) ||
    !validDuration(durationMs) ||
    typeof log !== 'string'
  ) {
    invalid()
  }
  let classification = 'unknown'
  if (/AssertionFailure|AssertionFailed|Assertion is false/.test(log)) {
    classification = 'assertion'
  } else if (
    /MaestroException\$ElementNotFound\b|Timed out waiting for element\b/.test(log)
  ) {
    classification = 'elementtimeout'
  } else if (/Snapshot failure while getting view hierarchy\./.test(log)) {
    classification = 'snapshot'
  } else if (
    /io\.grpc\.StatusRuntimeException: UNAVAILABLE:|Unable to connect to (?:Maestro |the )?driver\b|Failed to connect to (?:Maestro |the )?driver\b|Maestro Android driver did not start up in time\b/.test(
      log
    )
  ) {
    classification = 'driverconnection'
  }
  return { flow: flows.get(flow), classification, durationMs, platform }
}
