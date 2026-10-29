import fs from 'node:fs'
import path from 'node:path'
import { assertNativeFlowFailure } from '../lib/share-card-native-failure.mjs'
import {
  assertNativeFlowDiagnostics,
  writeRedactedNativeFailureImage,
} from '../lib/share-card-native-diagnostics.mjs'
import {
  assertBrowserWatermarkEvidence,
  browserWatermarkChecks,
} from '../lib/story68-browser-watermark.mjs'
import { assertWebStartupEvidence } from './wait-web.mjs'
import { WEB_MATRIX_SUMMARY_FILE, assertWebMatrixSummary } from './assert-web-matrix.mjs'
import {
  assertNativeEvidence,
  nativeEvidenceFamilies,
} from '../lib/story68-native-evidence-schema.mjs'
import { assertNativeHostEvidence } from '../ci/native-host-evidence.mjs'
import { assertNativeQuiesceEvidence } from '../ci/native-ios-quiesce.mjs'
import {
  OMITTED_FILE,
  selectPublicDiagnostics,
} from '../ci/native-ios-public-diagnostics.mjs'
const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const output = path.join(directory, 'public-evidence')
// Everything is written to a private staging directory first and moved into the
// uploaded directory only after every file validated, so a later refusal can never
// leave a partial public set behind.
const staging = path.join(directory, '.public-evidence-staging')
for (const target of [output, staging]) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
}
process.on('exit', () => fs.rmSync(staging, { recursive: true, force: true }))
let ciStatus
if (process.env.CC68_CI_PLATFORM !== undefined) {
  const platform = process.env.CC68_CI_PLATFORM
  const api = process.env.CC68_CI_API
  const jobStatus = process.env.CC68_CI_JOB_STATUS
  if (
    !['success', 'failure', 'cancelled'].includes(jobStatus) ||
    !(
      (platform === 'ios' && api === '0') ||
      (platform === 'android' && ['32', '36'].includes(api))
    )
  )
    throw new Error('invalid_native_ci_status')
  ciStatus = { platform, api: Number(api), jobStatus }
}
// Validate all failure records before copying any artifact. Filename and fields
// both use closed values, so raw Maestro output cannot enter public evidence.
const failures = new Map()
for (const platform of ['android', 'ios']) {
  const name = `native-flow-failure-${platform}.json`
  const file = path.join(directory, name)
  if (!fs.existsSync(file)) continue
  let record
  try {
    record = JSON.parse(fs.readFileSync(file))
  } catch {
    throw new Error('invalid_native_flow_failure')
  }
  assertNativeFlowFailure(record)
  if (record.platform !== platform) throw new Error('invalid_native_flow_failure')
  failures.set(name, record)
}
// Validate the entire diagnostic projection before copying any older proof.
const diagnostics = new Map()
for (const platform of ['android', 'ios']) {
  const name = `native-flow-diagnostics-${platform}.json`
  const file = path.join(directory, name)
  if (!fs.existsSync(file)) continue
  let value
  try {
    value = JSON.parse(fs.readFileSync(file))
  } catch {
    throw new Error('invalid_native_flow_diagnostics')
  }
  assertNativeFlowDiagnostics(value)
  if (value.platform !== platform) throw new Error('invalid_native_flow_diagnostics')
  diagnostics.set(name, value)
}
// Host load, first-flow phase times and Metro counts: closed numbers and names.
const hostEvidence = new Map()
for (const platform of ['ios']) {
  const name = `native-host-${platform}.json`
  const file = path.join(directory, name)
  if (!fs.existsSync(file)) continue
  let value
  try {
    value = JSON.parse(fs.readFileSync(file))
  } catch {
    throw new Error('invalid_native_host_evidence')
  }
  assertNativeHostEvidence(value)
  if (value.platform !== platform) throw new Error('invalid_native_host_evidence')
  hostEvidence.set(name, value)
}
const quiesceFile = path.join(directory, 'native-quiesce-ios.json')
if (fs.existsSync(quiesceFile)) {
  const value = JSON.parse(fs.readFileSync(quiesceFile, 'utf8'))
  assertNativeQuiesceEvidence(value)
  hostEvidence.set('native-quiesce-ios.json', value)
}
// iOS run diagnostics: a record is published only if every value is closed (no identifier,
// path or secret-shaped text). Records that fail are named in the omitted list, never copied.
const iosDiagnostics = selectPublicDiagnostics(directory)
// Only primitive proof facts cross the native evidence boundary. Private logs and
// resource identities are deliberately absent from the public projection.
const proofs = new Map()
const webStartupName = 'web-startup.json'
if (fs.existsSync(path.join(directory, webStartupName))) {
  let value
  try {
    value = JSON.parse(fs.readFileSync(path.join(directory, webStartupName)))
  } catch {
    throw new Error('invalid_web_startup_evidence')
  }
  assertWebStartupEvidence(value)
  proofs.set(webStartupName, value)
}
// Matrix, accessibility and permission records publish whole, so each must match its
// closed schema before anything is copied.
const nativeEvidence = new Map()
for (const name of nativeEvidenceFamilies) {
  const file = path.join(directory, name)
  if (!fs.existsSync(file)) continue
  let value
  try {
    value = JSON.parse(fs.readFileSync(file))
  } catch {
    throw new Error('invalid_native_evidence')
  }
  nativeEvidence.set(name, assertNativeEvidence(name, value))
}
// The browser acceptance summary is written to a private runtime file by
// assert-web-matrix.mjs and consumed here. It is re-validated against the closed matrix
// schema and projected from its validated fields, so the rebuilt upload directory keeps
// the proof.
const webMatrixFile = path.join(directory, WEB_MATRIX_SUMMARY_FILE)
let webMatrix
if (fs.existsSync(webMatrixFile)) {
  try {
    webMatrix = assertWebMatrixSummary(JSON.parse(fs.readFileSync(webMatrixFile)))
  } catch {
    throw new Error('invalid_web_matrix_evidence')
  } finally {
    // Consumed on read, valid or not, so a reused local runtime cannot republish it
    // after a later run that produced no new summary.
    fs.rmSync(webMatrixFile, { force: true })
  }
}
const releaseName = 'native-release-live-font-android.json'
const releaseFile = path.join(directory, releaseName)
if (fs.existsSync(releaseFile)) {
  const invalid = () => {
    throw new Error('invalid_native_proof_summary')
  }
  let value
  try {
    value = JSON.parse(fs.readFileSync(releaseFile))
  } catch {
    invalid()
  }
  if (value?.platform !== 'android' || typeof value.passed !== 'boolean') invalid()
  const summary = { platform: 'android', passed: value.passed }
  if (value.passed) {
    if (
      value.configuration !== 'Release' ||
      value.debuggable !== false ||
      !/^[a-f0-9]{64}$/.test(value.apkSha256 ?? '') ||
      !Number.isSafeInteger(value.beforeTitleHeight) ||
      value.beforeTitleHeight <= 0 ||
      !Number.isSafeInteger(value.afterTitleHeight) ||
      value.afterTitleHeight <= 0 ||
      !Number.isSafeInteger(value.beforeTextNodes) ||
      value.beforeTextNodes <= 0 ||
      value.afterTextNodes !== value.beforeTextNodes ||
      value.fontScaleBefore !== 1 ||
      value.fontScaleAfter !== 1.5
    )
      invalid()
    Object.assign(summary, {
      configuration: 'Release',
      debuggable: false,
      apkSha256: value.apkSha256,
      beforeTitleHeight: value.beforeTitleHeight,
      afterTitleHeight: value.afterTitleHeight,
      beforeTextNodes: value.beforeTextNodes,
      afterTextNodes: value.afterTextNodes,
      fontScaleBefore: 1,
      fontScaleAfter: 1.5,
    })
    for (const field of [
      'productionPreview',
      'localizedTitle',
      'watermarkOff',
      'fullRenderLabelPreserved',
      'cardStateRetainedOrRestored',
      'sameProcess',
      'noCrash',
      'noErrorSurface',
      'textNodesPreserved',
      'originalFontRestored',
    ]) {
      if (value[field] !== true) invalid()
      summary[field] = true
    }
  }
  proofs.set(releaseName, summary)
}
for (const platform of ['android', 'ios']) {
  for (const kind of ['rapid-watermark', 'fallback-focus']) {
    const name = `native-${kind}-${platform}.json`
    const file = path.join(directory, name)
    if (!fs.existsSync(file)) continue
    const invalid = () => {
      throw new Error('invalid_native_proof_summary')
    }
    let value
    try {
      value = JSON.parse(fs.readFileSync(file))
    } catch {
      invalid()
    }
    if (value?.platform !== platform || typeof value.passed !== 'boolean') invalid()
    const summary = { platform, passed: value.passed }
    if (value.passed) {
      const fields =
        kind === 'rapid-watermark'
          ? ['blockedSourceObserved', 'freshAppRuntime', 'readyOpenerBeforeLock']
          : [
              'postRemoved',
              'actualForegroundRevalidation',
              'ownedPostContentRestored',
              ...(platform === 'android'
                ? ['existingHeaderTrait']
                : ['intendedHeaderTarget', 'strictAuditAll']),
            ]
      for (const field of fields) {
        if (value[field] !== true) invalid()
        summary[field] = true
      }
      if (kind === 'rapid-watermark') {
        if (
          !Number.isFinite(value.heldMs) ||
          value.heldMs < 0 ||
          value.heldMs >= 12000 ||
          !Number.isSafeInteger(value.requests) ||
          value.requests < 3 ||
          value.unavailableResponses !== 0
        )
          invalid()
        Object.assign(summary, {
          heldMs: value.heldMs,
          requests: value.requests,
          unavailableResponses: 0,
        })
      } else {
        if (value.actualCursor !== (platform === 'android')) invalid()
        summary.actualCursor = value.actualCursor
      }
    }
    proofs.set(name, summary)
  }
}
const browserProofs = new Map()
for (const browser of ['chromium', 'firefox', 'webkit']) {
  for (const kind of ['', 'failure-']) {
    const name = `browser-watermark-${kind}${browser}.json`
    const file = path.join(directory, name)
    if (!fs.existsSync(file)) continue
    const invalid = () => {
      throw new Error('invalid_browser_watermark_evidence')
    }
    let value
    try {
      value = JSON.parse(fs.readFileSync(file))
    } catch {
      invalid()
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
    const {
      version,
      passed,
      code,
      phase,
      elapsedMs,
      heldMs,
      requests,
      unavailableResponses,
    } = value
    const projected = {
      version,
      browser: value.browser,
      passed,
      code,
      phase,
      elapsedMs,
      heldMs,
      requests,
      unavailableResponses,
      checks: Object.fromEntries(
        browserWatermarkChecks.map((key) => [key, value.checks?.[key]])
      ),
    }
    assertBrowserWatermarkEvidence(projected)
    if (
      projected.browser !== browser ||
      (kind === 'failure-' && projected.passed !== false)
    )
      invalid()
    browserProofs.set(name, projected)
  }
}
const closedJSON = (name, value) => {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|access_token|refresh_token|service_role|@example\.test|@cc68\.test/i.test(
      text
    )
  )
    throw new Error('private_data_in_public_evidence')
  fs.writeFileSync(path.join(staging, name), text)
}
// Startup can fail before a native flow exists. Preserve that outcome without
// fabricating a flow result or publishing provisioning logs.
if (ciStatus) closedJSON('ci-job-status.json', ciStatus)
if (webMatrix) closedJSON('web-matrix.json', webMatrix)
for (const [name, value] of browserProofs) closedJSON(name, value)
for (const [name, value] of hostEvidence) closedJSON(name, value)
for (const [name, value] of iosDiagnostics.published) closedJSON(name, value)
if (iosDiagnostics.omitted.length) closedJSON(OMITTED_FILE, iosDiagnostics.omitted)
for (const [name, value] of diagnostics) {
  closedJSON(name, value)
  // Re-render from validated primitives. Never trust or copy a claimed redacted PNG.
  await writeRedactedNativeFailureImage(
    value,
    path.join(staging, name.replace('.json', '-redacted.png'))
  )
}

for (const name of fs.readdirSync(directory)) {
  if (failures.has(name)) closedJSON(name, failures.get(name))
  if (proofs.has(name)) closedJSON(name, proofs.get(name))
  if (
    /^(saved-original-(android|ios)(-[a-z-]+)?|native-(android|ios)-[A-Za-z0-9-]+)\.png$/.test(
      name
    )
  )
    fs.copyFileSync(path.join(directory, name), path.join(staging, name))
  if (/^original-proof-(android|ios)(-[a-z-]+)?\.json$/.test(name)) {
    const proof = JSON.parse(fs.readFileSync(path.join(directory, name)))
    closedJSON(name, {
      sha256: proof.sha256,
      bytes: proof.bytes,
      chunks: proof.chunks,
      exactOneNewAsset: proof.exactOneNewAsset,
      featureCacheEmpty: proof.featureCacheEmpty,
    })
  }
  if (nativeEvidence.has(name)) closedJSON(name, nativeEvidence.get(name))
}
for (const name of fs.readdirSync(staging))
  fs.renameSync(path.join(staging, name), path.join(output, name))
console.log('Closed share-card evidence selected and secret-scanned.')
