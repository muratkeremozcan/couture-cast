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
  'holddeadline',
  'harnessstop',
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

/**
 * Raw Maestro output is used only for matching fixed signatures in memory. A harness that stops
 * Maestro itself passes its closed reason as `harnessStop`: a killed Maestro writes no failure
 * text, so its log alone would read as unknown. The reason decides the classification and is
 * never copied into the record.
 */
export function summarizeNativeFlowFailure({
  flow,
  platform,
  durationMs,
  log,
  harnessStop = null,
}) {
  if (
    !flows.has(flow) ||
    !validPlatform(platform) ||
    !validDuration(durationMs) ||
    typeof log !== 'string' ||
    (harnessStop !== null && typeof harnessStop !== 'string')
  ) {
    invalid()
  }
  let classification = 'unknown'
  if (
    harnessStop === 'rapid_watermark_hold_deadline' ||
    harnessStop === 'rapid_watermark_request_deadline'
  ) {
    classification = 'holddeadline'
  } else if (harnessStop !== null) {
    classification = 'harnessstop'
  } else if (/AssertionFailure|AssertionFailed|Assertion is false/.test(log)) {
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
