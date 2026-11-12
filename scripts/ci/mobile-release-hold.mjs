#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Refuses a production mobile build while `apps/mobile/release-hold.json` holds the app's SDK
// (story 6.15 D12, R2-06). SDK 56 ships a Hermes memory regression for apps importing Worklets or
// Reanimated; Expo's SDK 57 notes name `expo` 57.0.17 with React Native 0.86.3 as the fix.
// - Step 2 adds the hold with `heldFrom: 56`. From then on the file must exist, so deleting it
//   cannot release a build; the repository test enforces that.
// - A build is allowed only through a lift measured on the app's current SDK, with peak and
//   settled memory each at most LIFT_LIMIT times the Step 1 control, a recorded date and evidence.
//   A lift from an earlier SDK does not carry over; a lift on SDK 57 or later also needs
//   `expo` 57.0.17 or later.
//
// apps/mobile/release-hold.json:
//   { "heldFrom": 56, "reason": "...", "lifts": [ { "sdk": 57, "expo": "57.0.33",
//     "measuredAt": "...", "peakRatio": 1.03, "settledRatio": 1.01, "evidence": "..." } ] }
import fs, { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HELD_FROM_SDK = 56
export const LIFT_LIMIT = 1.1
export const FIXED_EXPO = '57.0.17'

const version = (text) =>
  (/(\d+)\.(\d+)\.(\d+)/.exec(text ?? '') ?? []).slice(1).map(Number)
function atLeast(actual, minimum) {
  const [a, b] = [version(actual), version(minimum)]
  if (a.length !== 3) return false
  for (let index = 0; index < 3; index += 1)
    if (a[index] !== b[index]) return a[index] > b[index]
  return true
}

function liftProblem(lift, sdk, expoVersion) {
  if (lift.sdk !== sdk) return `measured on SDK ${lift.sdk}, the app is on SDK ${sdk}`
  if (!(lift.peakRatio <= LIFT_LIMIT && lift.settledRatio <= LIFT_LIMIT))
    return `memory ratios ${lift.peakRatio} and ${lift.settledRatio} exceed ${LIFT_LIMIT}`
  if (!lift.evidence || Number.isNaN(Date.parse(lift.measuredAt)))
    return 'missing evidence or measurement date'
  if (sdk >= 57 && !atLeast(expoVersion, FIXED_EXPO))
    return `expo ${expoVersion} is older than the fixed ${FIXED_EXPO}`
  return null
}

/** @returns {{ allowed: boolean, reason: string }} */
export function evaluateReleaseHold({ hold, expoRange, expoVersion }) {
  const sdk = version(expoRange)[0]
  if (!hold) {
    return sdk >= HELD_FROM_SDK
      ? {
          allowed: false,
          reason: `SDK ${sdk} needs apps/mobile/release-hold.json; it was removed`,
        }
      : { allowed: true, reason: 'no release hold' }
  }
  if (hold.heldFrom !== HELD_FROM_SDK || !hold.reason || !Array.isArray(hold.lifts))
    return { allowed: false, reason: 'release hold file is malformed' }
  const problems = hold.lifts.map((lift) => liftProblem(lift, sdk, expoVersion))
  const index = problems.indexOf(null)
  if (index >= 0)
    return {
      allowed: true,
      reason: `SDK ${sdk} released by the measurement of ${hold.lifts[index].measuredAt}`,
    }
  return {
    allowed: false,
    reason: `SDK ${sdk} is held: ${hold.reason}${problems.length ? ` (${problems.join('; ')})` : ''}`,
  }
}

export function readReleaseHold(root) {
  const holdFile = path.join(root, 'apps/mobile/release-hold.json')
  const hold = fs.existsSync(holdFile)
    ? JSON.parse(fs.readFileSync(holdFile, 'utf8'))
    : null
  const expoRange = JSON.parse(
    fs.readFileSync(path.join(root, 'apps/mobile/package.json'), 'utf8')
  ).dependencies.expo
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const expoVersion =
    lock.packages['apps/mobile/node_modules/expo']?.version ??
    lock.packages['node_modules/expo']?.version
  return { hold, expoRange, expoVersion }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const verdict = evaluateReleaseHold(readReleaseHold(root))
  console.log(`mobile-release-hold: ${verdict.reason}`)
  process.exit(verdict.allowed ? 0 : 1)
}
