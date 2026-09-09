import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const manifestPath = path.join(
  projectRoot,
  'apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
)
const lockfilePath = path.join(projectRoot, 'package-lock.json')

// These three ship only inside the union @tensorflow/tfjs package, so any mention of one in
// the lockfile means the 286 MB union came back in place of the three packages this worker
// actually loads.
const UNION_ONLY_PACKAGES = [
  '@tensorflow/tfjs-layers',
  '@tensorflow/tfjs-data',
  '@tensorflow/tfjs-backend-webgl',
]
const TFJS_UNION_PACKAGE = '@tensorflow/tfjs'
const TFJS_ALIAS_TARGET = '@tensorflow/tfjs-core'
// The exact set manifest.thresholds mirrors out of the policy's image block. It is fixed
// here, not read off the manifest, so this script and the loader in
// apps/api/src/modules/community/community-screening-policy.ts fail on the same input. Two
// supply-chain checks that disagree about what counts as drift are worse than one.
// Adding a threshold means editing both files and this list together, on purpose.
const MIRRORED_THRESHOLD_KEYS = [
  'neutralPassMinimum',
  'unsafeAggregateMaximum',
  'unsafeBlockMinimum',
  'unsafeClasses',
  'probabilitySumTolerance',
]
const EXPECTED_CLASS_COUNT = 5
const SCREENER_ENV = 'COMMUNITY_NSFW_SCREENER'
const TENSORFLOW_SCREENER = 'tensorflow'

const emitJson = process.argv.includes('--json')
const failures = []

// Assigned once the selector gate has passed, so that an incident-mode start never touches the
// manifest at all.
let manifest = null

// Resolution starts at apps/api/ so that a package hoisted to the repository root and one
// installed under apps/api/node_modules both resolve; npm places the nsfwjs peer alias in the
// second location today and a later dedupe can move either.
const requireFromApi = createRequire(pathToFileURL(path.join(projectRoot, 'apps/api/')))
const packageCache = new Map()

function fail(message) {
  failures.push(message)
}

function log(message) {
  if (!emitJson) console.log(message)
}

function logPassed(ok, message) {
  if (ok) log(message)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function format(value) {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

function toRepoPath(absolutePath) {
  const relativePath = path.relative(projectRoot, absolutePath)
  return relativePath.startsWith('..') ? absolutePath : relativePath
}

// Manifest and policy values are JSON scalars and string arrays. An object on either side is
// therefore already a shape error, and reporting it as a mismatch is the right direction.
function isDeepEqual(left, right) {
  if (left === right) return true
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  return (
    left.length === right.length &&
    left.every((item, index) => isDeepEqual(item, right[index]))
  )
}

// Keep this streamed digest implementation aligned with
// scripts/prepare-garment-tagging-model.mjs and the inference worker.
async function computeSha256(filePath) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

function findPackageRootUp(startDir, packageName) {
  for (let dir = startDir; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'package.json')
    if (fs.existsSync(candidate) && readJson(candidate).name === packageName) {
      return dir
    }
  }
  throw new Error(`No package.json claiming ${packageName} was found above ${startDir}.`)
}

function fallbackSpecifier(packageName) {
  return packageName === manifest.packageName ? manifest.modelSubpath : packageName
}

function resolvePackageRootDir(packageName) {
  try {
    return path.dirname(requireFromApi.resolve(`${packageName}/package.json`))
  } catch {
    // nsfwjs and bad-words publish an exports map with no "./package.json" entry, so the
    // direct lookup throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolving a published export and
    // walking up to the owning package.json keeps this free of hardcoded node_modules paths.
    const entryPoint = requireFromApi.resolve(fallbackSpecifier(packageName))
    return findPackageRootUp(path.dirname(entryPoint), packageName)
  }
}

function resolvePackageUncached(packageName) {
  try {
    const root = resolvePackageRootDir(packageName)
    const version = readJson(path.join(root, 'package.json')).version ?? null
    return { package: packageName, root, version, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { package: packageName, root: null, version: null, error: message }
  }
}

function resolvePackage(packageName) {
  const cached = packageCache.get(packageName)
  if (cached) return cached
  const resolved = resolvePackageUncached(packageName)
  packageCache.set(packageName, resolved)
  return resolved
}

function describeVersion(resolved) {
  return resolved.version ?? `unresolved (${resolved.error})`
}

function checkModelPackageVersion() {
  const resolved = resolvePackage(manifest.packageName)
  const ok = resolved.version === manifest.packageVersion
  if (!ok) {
    fail(
      `Model package ${manifest.packageName} is ${describeVersion(resolved)}, but the manifest pins ${manifest.packageVersion}.`
    )
  }
  return {
    package: manifest.packageName,
    expected: manifest.packageVersion,
    actual: resolved.version,
    ok,
  }
}

function checkPinnedDependency(packageName, expected) {
  const resolved = resolvePackage(packageName)
  const ok = resolved.version === expected
  if (!ok) {
    fail(
      `Dependency ${packageName} is ${describeVersion(resolved)}, but the manifest pins ${expected}.`
    )
  }
  return { package: packageName, expected, actual: resolved.version, ok }
}

function checkPinnedDependencies() {
  return Object.entries(manifest.dependencies).map(([packageName, expected]) =>
    checkPinnedDependency(packageName, expected)
  )
}

async function checkArtifactFile(entry, kind) {
  const resolved = resolvePackage(entry.package)
  const result = {
    kind,
    package: entry.package,
    path: entry.path,
    expected: entry.sha256,
  }
  if (resolved.root === null) {
    fail(
      `Package ${entry.package} did not resolve, so ${entry.path} could not be hashed.`
    )
    return { ...result, resolvedPath: null, actual: null, ok: false }
  }
  const fullPath = path.join(resolved.root, entry.path)
  const resolvedPath = toRepoPath(fullPath)
  if (!fs.existsSync(fullPath)) {
    fail(`Missing ${kind} artifact ${resolvedPath}.`)
    return { ...result, resolvedPath, actual: null, ok: false }
  }
  const actual = await computeSha256(fullPath)
  const ok = actual.toLowerCase() === String(entry.sha256).toLowerCase()
  if (!ok) {
    fail(
      `Checksum mismatch for ${resolvedPath}: expected ${entry.sha256}, got ${actual}.`
    )
  }
  return { ...result, resolvedPath, actual, ok }
}

async function checkArtifactFiles() {
  const results = []
  for (const entry of manifest.modelFiles) {
    results.push(await checkArtifactFile(entry, 'model'))
  }
  for (const entry of manifest.wasmFiles) {
    results.push(await checkArtifactFile(entry, 'wasm'))
  }
  return results
}

function checkForbiddenPackage(forbidden, lockEntries) {
  const found = []
  for (const [key, value] of lockEntries) {
    if (!key.endsWith(`node_modules/${forbidden}`)) continue
    const aliasedTo = value?.name ?? null
    // The repository satisfies the nsfwjs @tensorflow/tfjs peer edge with an alias onto
    // tfjs-core, so this key legitimately exists. An entry without that alias is a real
    // union install and fails.
    const ok = forbidden === TFJS_UNION_PACKAGE && aliasedTo === TFJS_ALIAS_TARGET
    if (!ok) {
      fail(
        `Forbidden dependency ${forbidden} is installed at ${key} as ${aliasedTo ?? forbidden}.`
      )
    }
    found.push({ key, aliasedTo, ok })
  }
  return found
}

function checkForbiddenDependencies(lockfile, lockfileText) {
  const lockEntries = Object.entries(lockfile.packages ?? {})
  const entries = manifest.forbiddenDependencies.flatMap((forbidden) =>
    checkForbiddenPackage(forbidden, lockEntries)
  )
  const unionMembers = UNION_ONLY_PACKAGES.filter((name) => lockfileText.includes(name))
  for (const name of unionMembers) {
    fail(
      `Union-only package ${name} appears in the lockfile, so the tfjs union came back.`
    )
  }
  return {
    entries,
    unionMembers,
    ok: entries.every((entry) => entry.ok) && unionMembers.length === 0,
  }
}

async function checkPolicy() {
  const policyPath = path.resolve(path.dirname(manifestPath), manifest.policy.path)
  const base = {
    path: toRepoPath(policyPath),
    expectedSha256: manifest.policy.sha256,
    expectedVersion: manifest.policy.version,
  }
  if (!fs.existsSync(policyPath)) {
    fail(`Policy file not found at ${base.path}.`)
    return { policy: null, result: { ...base, sha256: null, version: null, ok: false } }
  }
  const sha256 = await computeSha256(policyPath)
  const policy = readJson(policyPath)
  const version = policy.version ?? null
  const hashOk = sha256.toLowerCase() === String(manifest.policy.sha256).toLowerCase()
  if (!hashOk) {
    fail(
      `Policy checksum mismatch for ${base.path}: expected ${manifest.policy.sha256}, got ${sha256}.`
    )
  }
  const versionOk = version === manifest.policy.version
  if (!versionOk) {
    fail(
      `Policy version is ${version}, but the manifest pins ${manifest.policy.version}.`
    )
  }
  return { policy, result: { ...base, sha256, version, ok: hashOk && versionOk } }
}

function checkThresholdKey(key, manifestValue, policyValue) {
  const ok = isDeepEqual(manifestValue, policyValue)
  if (!ok && policyValue === undefined) {
    fail(
      `Threshold ${key} is pinned as ${format(manifestValue)} but the policy image block has no ${key} field to mirror.`
    )
  } else if (!ok) {
    fail(
      `Threshold ${key} has drifted: the manifest says ${format(manifestValue)} and the policy says ${format(policyValue)}.`
    )
  }
  return { key, manifest: manifestValue, policy: policyValue, ok }
}

function checkThresholds(policyImage) {
  const thresholds = manifest.thresholds ?? {}
  const presentKeys = Object.keys(thresholds).toSorted()
  const expectedKeys = [...MIRRORED_THRESHOLD_KEYS].toSorted()
  const keysMatch = presentKeys.join(',') === expectedKeys.join(',')
  if (!keysMatch) {
    fail(
      `Manifest thresholds must mirror exactly ${expectedKeys.join(', ')} but carries ${presentKeys.join(', ') || 'nothing'}.`
    )
  }
  const keys = MIRRORED_THRESHOLD_KEYS.map((key) =>
    checkThresholdKey(key, thresholds[key], policyImage[key])
  )
  return {
    keysMatch,
    keys,
    ok: keysMatch && keys.every((entry) => entry.ok),
  }
}

function checkClassNames(policyImage) {
  const classNames = manifest.classNames ?? []
  const matchesPolicy = isDeepEqual(classNames, policyImage.classNames)
  if (!matchesPolicy) {
    fail(
      `Manifest class names ${format(classNames)} do not match the policy image.classNames, which are ${format(policyImage.classNames)}.`
    )
  }
  const countOk = classNames.length === EXPECTED_CLASS_COUNT
  if (!countOk) {
    fail(
      `Manifest class names must number ${EXPECTED_CLASS_COUNT}, but number ${classNames.length}.`
    )
  }
  const unsafeClasses = manifest.thresholds?.unsafeClasses ?? []
  const unknown = unsafeClasses.filter((name) => !classNames.includes(name))
  if (unknown.length > 0) {
    fail(
      `Unsafe classes ${unknown.join(', ')} are not members of the manifest class names.`
    )
  }
  return {
    classNames,
    matchesPolicy,
    countOk,
    unknownUnsafeClasses: unknown,
    ok: matchesPolicy && countOk && unknown.length === 0,
  }
}

function reportHuman(report) {
  for (const entry of report.packages) {
    log(
      `Resolved ${entry.package}@${describeVersion(entry)} at ${entry.root ?? 'nowhere'}.`
    )
  }
  for (const file of report.files) {
    logPassed(file.ok, `Verified ${file.kind} artifact ${file.resolvedPath}.`)
  }
  logPassed(
    report.modelPackage.ok,
    `Model package ${report.modelPackage.package} is pinned at ${report.modelPackage.actual}.`
  )
  logPassed(
    report.dependencies.every((entry) => entry.ok),
    `All ${report.dependencies.length} pinned dependencies match their installed versions.`
  )
  logPassed(
    report.forbiddenDependencies.ok,
    `No forbidden dependency is installed, and ${TFJS_UNION_PACKAGE} resolves to ${TFJS_ALIAS_TARGET}.`
  )
  logPassed(
    report.policy.ok,
    `Policy ${report.policy.path} matches its pinned hash at version ${report.policy.version}.`
  )
  logPassed(
    report.thresholds.ok,
    `All ${report.thresholds.keys.length} thresholds mirror the policy image block.`
  )
  logPassed(
    report.classNames.ok,
    `All ${report.classNames.classNames.length} class names match the policy and cover every unsafe class.`
  )
}

// COMMUNITY_NSFW_SCREENER=unavailable with COMMUNITY_NSFW_INCIDENT_MODE=unavailable is the
// authorized way to run production without a working model. This script is a pre-hook on the
// production community worker start command, so verifying unconditionally would refuse to start
// the process during the very incident that mode exists for.
function reportSkippedSelector(selector) {
  const seen = selector === '' ? 'unset' : selector
  const reason = 'no real model is loaded and there is nothing to verify'
  if (emitJson) {
    console.log(
      JSON.stringify(
        {
          manifest: toRepoPath(manifestPath),
          status: 'skipped',
          ok: null,
          verified: false,
          selector: selector === '' ? null : selector,
          reason: `${SCREENER_ENV}=${seen}, so ${reason}.`,
          failures: [],
        },
        null,
        2
      )
    )
    return
  }
  console.log(`Skipped: ${SCREENER_ENV}=${seen}, so ${reason}.`)
}

function readFileOrExit(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`${label} not found at ${filePath}.`)
    process.exit(1)
  }
  return fs.readFileSync(filePath, 'utf8')
}

async function main() {
  const selector = (process.env[SCREENER_ENV] ?? '').trim()
  if (selector !== TENSORFLOW_SCREENER) {
    reportSkippedSelector(selector)
    process.exit(0)
  }

  manifest = JSON.parse(readFileOrExit(manifestPath, 'Manifest file'))
  log(`Verifying ${toRepoPath(manifestPath)}.`)
  const lockfileText = readFileOrExit(lockfilePath, 'Lockfile')
  const lockfile = JSON.parse(lockfileText)

  const modelPackage = checkModelPackageVersion()
  const dependencies = checkPinnedDependencies()
  const files = await checkArtifactFiles()
  const forbiddenDependencies = checkForbiddenDependencies(lockfile, lockfileText)
  const { policy, result: policyResult } = await checkPolicy()
  const policyImage = policy === null ? {} : (policy.image ?? {})
  const thresholds = checkThresholds(policyImage)
  const classNames = checkClassNames(policyImage)

  const report = {
    manifest: toRepoPath(manifestPath),
    manifestVersion: manifest.manifestVersion,
    modelFamily: manifest.modelFamily,
    status: failures.length === 0 ? 'verified' : 'failed',
    ok: failures.length === 0,
    verified: failures.length === 0,
    selector,
    packages: [...packageCache.values()].map((entry) => ({
      ...entry,
      root: entry.root === null ? null : toRepoPath(entry.root),
    })),
    modelPackage,
    dependencies,
    files,
    forbiddenDependencies,
    policy: policyResult,
    thresholds,
    classNames,
    failures,
  }

  if (emitJson) {
    console.log(JSON.stringify(report, null, 2))
    process.exit(report.ok ? 0 : 1)
  }

  reportHuman(report)
  for (const failure of failures) {
    console.error(failure)
  }
  if (!report.ok) {
    const problems = failures.length === 1 ? 'problem' : 'problems'
    console.error(
      `❌ Community screening model verification failed with ${failures.length} ${problems}.`
    )
    process.exit(1)
  }
  console.log('✅ Community screening model, policy, and supply chain verified.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Community screening model verification error:', err)
  process.exit(1)
})
