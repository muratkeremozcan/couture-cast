#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Refuses a production mobile build while `apps/mobile/release-hold.json` holds the app's SDK
// (story 6.15 D12, R2-06, R3-02). SDK 56 ships a Hermes memory regression for apps importing
// Worklets or Reanimated; Expo's SDK 57 notes name `expo` 57.0.17 with React Native 0.86.3 as the
// fix.
// - From SDK 56 the hold file must exist, so deleting it cannot release a build.
// - A build is released only by a lift whose evidence is a committed measurement artifact. The
//   artifact is the single source of the numbers: the check reads it, requires it to name the
//   app's SDK and installed expo version, a Step 1 (SDK 55) control and an identified build, and
//   recomputes peak and settled ratios per platform from finite positive raw measurements. Every
//   ratio must be at most LIFT_LIMIT. SDK 57 or later also needs expo 57.0.17 or later.
//
// apps/mobile/release-hold.json: { "heldFrom": 56, "reason": "...", "lifts": ["<artifact path>"] }
// artifact: { "sdk": 57, "expoVersion": "57.0.33", "measuredAt": "...",
//   "build": { "commit": "<40 hex>", "android": "<apk sha256>", "ios": "<app sha256>" },
//   "control": { "sdk": 55, "expoVersion": "55.0.32", "commit": "<40 hex>" },
//   "android": { "control": { "peakMb": 310, "settledMb": 240 }, "candidate": { ... } },
//   "ios": { "control": { "peakMb": 280, "settledMb": 210 }, "candidate": { ... } } }
import fs, { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HELD_FROM_SDK = 56
export const CONTROL_SDK = 55
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
const positive = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
const sha = (value, length) =>
  typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value)

function platformRatios(name, entry) {
  const values = [
    entry?.control?.peakMb,
    entry?.control?.settledMb,
    entry?.candidate?.peakMb,
    entry?.candidate?.settledMb,
  ]
  if (!values.every(positive))
    return { problem: `${name} measurements must be finite positive numbers` }
  return {
    peak: entry.candidate.peakMb / entry.control.peakMb,
    settled: entry.candidate.settledMb / entry.control.settledMb,
  }
}

function identityProblem(artifact, sdk, expoVersion) {
  if (artifact.sdk !== sdk)
    return `measured on SDK ${artifact.sdk}, the app is on SDK ${sdk}`
  if (artifact.expoVersion !== expoVersion)
    return `measured on expo ${artifact.expoVersion}, the app installs ${expoVersion}`
  if (
    artifact.control?.sdk !== CONTROL_SDK ||
    !version(artifact.control?.expoVersion).length
  )
    return `the control must be the Step 1 SDK ${CONTROL_SDK} build`
  if (!sha(artifact.build?.commit, 40) || !sha(artifact.control?.commit, 40))
    return 'build and control commits must be recorded'
  if (!sha(artifact.build?.android, 64) || !sha(artifact.build?.ios, 64))
    return 'the measured Android and iOS builds must be identified by SHA-256'
  if (Number.isNaN(Date.parse(artifact.measuredAt))) return 'missing measurement date'
  return null
}

/** @returns {string | null} why this lift does not release the build, or null when it does */
export function liftProblem(artifact, sdk, expoVersion) {
  if (!artifact || typeof artifact !== 'object')
    return 'evidence artifact missing or unreadable'
  const identity = identityProblem(artifact, sdk, expoVersion)
  if (identity) return identity
  for (const name of ['android', 'ios']) {
    const ratios = platformRatios(name, artifact[name])
    if (ratios.problem) return ratios.problem
    if (ratios.peak > LIFT_LIMIT || ratios.settled > LIFT_LIMIT)
      return `${name} memory ratios ${ratios.peak.toFixed(3)} and ${ratios.settled.toFixed(3)} exceed ${LIFT_LIMIT}`
  }
  if (sdk >= 57 && !atLeast(expoVersion, FIXED_EXPO))
    return `expo ${expoVersion} is older than the fixed ${FIXED_EXPO}`
  return null
}

/** @returns {{ allowed: boolean, reason: string }} */
export function evaluateReleaseHold({ hold, expoRange, expoVersion, readArtifact }) {
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
  const problems = []
  for (const evidence of hold.lifts) {
    const problem =
      typeof evidence === 'string' && evidence
        ? liftProblem(readArtifact(evidence), sdk, expoVersion)
        : 'a lift must name its evidence artifact'
    if (!problem) return { allowed: true, reason: `SDK ${sdk} released by ${evidence}` }
    problems.push(`${evidence}: ${problem}`)
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
  const readArtifact = (relative) => {
    const full = path.resolve(root, relative)
    if (!full.startsWith(`${root}${path.sep}`) || !fs.existsSync(full)) return null
    try {
      return JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch {
      return null
    }
  }
  return { hold, expoRange, expoVersion, readArtifact }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const verdict = evaluateReleaseHold(readReleaseHold(root))
  console.log(`mobile-release-hold: ${verdict.reason}`)
  process.exit(verdict.allowed ? 0 : 1)
}
