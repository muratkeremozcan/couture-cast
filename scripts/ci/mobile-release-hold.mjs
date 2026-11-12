#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Refuses a production mobile build while `apps/mobile/release-hold.json` holds the SDK the app is
// on (story 6.15 D12). SDK 56 ships a Hermes memory regression for apps importing Worklets or
// Reanimated, fixed in SDK 57, so Step 2 adds a hold and Step 3 deletes it. A hold lifts early
// only through a recorded measurement that stayed within its limit.
//
// apps/mobile/release-hold.json:
//   { "sdk": 56, "reason": "...", "lift": null | { "measuredAt": "...", "peakRatio": 1.04,
//     "settledRatio": 1.02, "limit": 1.1, "evidence": "..." } }
import fs, { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @returns {{ allowed: boolean, reason: string }} */
export function evaluateReleaseHold({ hold, expoRange }) {
  if (!hold) return { allowed: true, reason: 'no release hold' }
  const sdk = Number(/^[~^]?(\d+)\./.exec(expoRange ?? '')?.[1])
  if (!Number.isInteger(hold.sdk) || !hold.reason)
    return { allowed: false, reason: 'release hold file is malformed' }
  if (sdk !== hold.sdk)
    return {
      allowed: false,
      reason: `release hold names SDK ${hold.sdk} but the app is on SDK ${sdk}; delete the stale hold`,
    }
  const lift = hold.lift
  if (!lift) return { allowed: false, reason: `SDK ${hold.sdk} is held: ${hold.reason}` }
  const within =
    typeof lift.limit === 'number' &&
    lift.peakRatio <= lift.limit &&
    lift.settledRatio <= lift.limit &&
    Boolean(lift.evidence) &&
    !Number.isNaN(Date.parse(lift.measuredAt))
  return within
    ? {
        allowed: true,
        reason: `SDK ${hold.sdk} hold lifted by measurement ${lift.measuredAt}`,
      }
    : { allowed: false, reason: `SDK ${hold.sdk} hold lift does not meet its limit` }
}

export function readReleaseHold(root) {
  const holdFile = path.join(root, 'apps/mobile/release-hold.json')
  const hold = fs.existsSync(holdFile)
    ? JSON.parse(fs.readFileSync(holdFile, 'utf8'))
    : null
  const expoRange = JSON.parse(
    fs.readFileSync(path.join(root, 'apps/mobile/package.json'), 'utf8')
  ).dependencies.expo
  return { hold, expoRange }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const verdict = evaluateReleaseHold(readReleaseHold(root))
  console.log(`mobile-release-hold: ${verdict.reason}`)
  process.exit(verdict.allowed ? 0 : 1)
}
