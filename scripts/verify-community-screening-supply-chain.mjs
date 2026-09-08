import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const apiDir = path.join(projectRoot, 'apps/api')

const SCRIPT_PATH = 'scripts/verify-community-screening-supply-chain.mjs'
const MANIFEST_PATH =
  'apps/api/model-manifests/community-nsfw-mobilenet-v2-mid-nsfwjs-4.3.0.json'
const LOCKFILE_PATH = 'package-lock.json'
const API_LOCK_DIR = 'apps/api'
const LICENSE_FILE_PATTERN = /^licen[cs]e(\.[^/]*)?$/i

// An allowlist of the licences someone here has actually read for this dependency set, not a
// general SPDX parser. A value outside it is not unknown syntax, it is a licence nobody
// reviewed, so the command fails and asks for that review instead of inferring its terms.
const REVIEWED_SPDX_LICENSES = ['Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'MIT']

// `<licence> WITH <exception>` needs the exception reviewed as well. Nothing in this tree
// carries one, so the reviewed set is empty and any WITH expression fails until someone adds it.
const REVIEWED_SPDX_EXCEPTIONS = []

const CHECK_LICENCES = 'dependency-license-spdx'
const CHECK_INSTALL = 'lockfile-install-agreement'
const CHECK_WEIGHTS = 'model-weight-redistribution'
const CHECK_NAMES = [CHECK_LICENCES, CHECK_INSTALL, CHECK_WEIGHTS]

const emitJson = process.argv.includes('--json')

function readJson(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
}

function readRequiredJson(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    console.error(`Required file not found at ${absolutePath}.`)
    process.exit(1)
  }
  return readJson(absolutePath)
}

function toRepoPath(absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/')
}

// Node's module-resolution errors append a multi-line require stack that repeats the anchor the
// failure line already names, so the first line carries everything a reader needs.
function errorSummary(error) {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0]
}

function tokenizeSpdx(value) {
  return value
    .replace(/([()])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean)
}

function isReviewedIdentifier(token) {
  if (typeof token !== 'string') return false
  const identifier = token.endsWith('+') ? token.slice(0, -1) : token
  return REVIEWED_SPDX_LICENSES.includes(identifier)
}

function parseSpdxTerm(tokens, at) {
  if (tokens[at] === '(') {
    const inner = parseSpdxExpression(tokens, at + 1)
    if (!inner.ok || tokens[inner.next] !== ')') return { ok: false, next: at }
    return { ok: true, next: inner.next + 1 }
  }
  if (!isReviewedIdentifier(tokens[at])) return { ok: false, next: at }
  if (tokens[at + 1] !== 'WITH') return { ok: true, next: at + 1 }
  if (!REVIEWED_SPDX_EXCEPTIONS.includes(tokens[at + 2])) return { ok: false, next: at }
  return { ok: true, next: at + 3 }
}

function parseSpdxExpression(tokens, at) {
  let cursor = at
  for (;;) {
    const term = parseSpdxTerm(tokens, cursor)
    if (!term.ok) return { ok: false, next: cursor }
    cursor = term.next
    const operator = tokens[cursor]
    if (operator !== 'AND' && operator !== 'OR') return { ok: true, next: cursor }
    cursor += 1
  }
}

function isReviewedSpdxExpression(value) {
  const tokens = tokenizeSpdx(value)
  if (tokens.length === 0) return false
  const parsed = parseSpdxExpression(tokens, 0)
  return parsed.ok && parsed.next === tokens.length
}

function readDeclaredLicence(pkg) {
  if (typeof pkg.license === 'string') {
    return { value: pkg.license.trim(), source: 'license' }
  }
  if (typeof pkg.license?.type === 'string') {
    return { value: pkg.license.type.trim(), source: 'license.type' }
  }
  if (typeof pkg.licenses === 'string') {
    return { value: pkg.licenses.trim(), source: 'licenses' }
  }
  if (Array.isArray(pkg.licenses)) {
    // The legacy array form offers a choice between licences, which SPDX writes as OR.
    const types = pkg.licenses
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter((type) => typeof type === 'string')
    return { value: types.join(' OR ').trim(), source: 'licenses[]' }
  }
  return { value: '', source: 'none' }
}

function describeLicenceProblem(declared) {
  if (declared.value === '') return 'declares no licence'
  if (declared.value.toUpperCase() === 'UNLICENSED') return 'declares UNLICENSED'
  if (/^SEE LICEN[CS]E IN /i.test(declared.value)) {
    return `defers to a file with "${declared.value}"`
  }
  if (!isReviewedSpdxExpression(declared.value)) {
    return `declares "${declared.value}", which is not a reviewed SPDX expression`
  }
  return null
}

function parentLockDir(lockDir) {
  const nested = lockDir.lastIndexOf('/node_modules/')
  if (nested >= 0) return lockDir.slice(0, nested)
  const separator = lockDir.lastIndexOf('/')
  return separator >= 0 ? lockDir.slice(0, separator) : ''
}

// npm resolves a dependency by walking node_modules upward from the dependent, and lockfile keys
// mirror that layout, so the same walk finds the entry npm installed. Nested duplicates are why
// this matters: webidl-conversions is 3.0.1 under whatwg-url and 5.0.0 at the repository root.
function findLockKey(lockfile, lockDir, name) {
  let dir = lockDir
  for (;;) {
    const key = dir === '' ? `node_modules/${name}` : `${dir}/node_modules/${name}`
    if (lockfile.packages[key]) return key
    if (dir === '') return null
    dir = parentLockDir(dir)
  }
}

function walkUpToPackageRoot(startDir, name) {
  let dir = startDir
  for (;;) {
    const candidate = path.join(dir, 'package.json')
    if (fs.existsSync(candidate) && readJson(candidate).name === name) return dir
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(`No package.json declaring ${name} above ${startDir}.`)
    }
    dir = parent
  }
}

// nsfwjs, bad-words and badwords-list publish an `exports` map that omits `./package.json`, so
// resolving that path throws; resolve a published export instead and walk up to the package root.
// Every resolution starts from a real directory rather than a constructed node_modules path, so
// hoisted, workspace-local and nested installs all resolve the way the runtime would.
function resolvePackageDir(name, fromDir) {
  const resolver = createRequire(path.join(fromDir, 'package.json'))
  try {
    return path.dirname(resolver.resolve(`${name}/package.json`))
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
  }
  return walkUpToPackageRoot(path.dirname(resolver.resolve(name)), name)
}

function dependencyNames(lockEntry) {
  const names = new Set([
    ...Object.keys(lockEntry.dependencies ?? {}),
    ...Object.keys(lockEntry.optionalDependencies ?? {}),
  ])
  for (const name of Object.keys(lockEntry.peerDependencies ?? {})) {
    if (!lockEntry.peerDependenciesMeta?.[name]?.optional) names.add(name)
  }
  return [...names]
}

function inspectPackage(item, lockEntry, lockKey) {
  const record = {
    name: item.name,
    installedName: null,
    version: null,
    lockVersion: lockEntry.version ?? null,
    license: null,
    licenseSource: null,
    lockPath: lockKey,
    resolvedFrom: null,
    direct: item.direct,
    dir: null,
    problems: [],
  }
  try {
    record.dir = resolvePackageDir(item.name, item.fromDir)
  } catch (error) {
    record.problems.push({
      check: CHECK_INSTALL,
      detail: `${item.name} is recorded at ${lockKey} but does not resolve from ${toRepoPath(item.fromDir)}: ${errorSummary(error)}`,
    })
    return record
  }
  const pkg = readJson(path.join(record.dir, 'package.json'))
  const declared = readDeclaredLicence(pkg)
  record.installedName = pkg.name ?? null
  record.version = pkg.version ?? null
  record.license = declared.value === '' ? null : declared.value
  record.licenseSource = declared.source
  record.resolvedFrom = toRepoPath(record.dir)
  addPackageProblems(record, declared)
  return record
}

function addPackageProblems(record, declared) {
  if (record.version !== record.lockVersion) {
    record.problems.push({
      check: CHECK_INSTALL,
      detail: `${record.name} installs ${record.version} at ${record.resolvedFrom} where ${LOCKFILE_PATH} records ${record.lockVersion}`,
    })
  }
  const licenceProblem = describeLicenceProblem(declared)
  if (licenceProblem) {
    record.problems.push({
      check: CHECK_LICENCES,
      detail: `${record.name}@${record.version} ${licenceProblem}`,
    })
  }
}

function collectPackages(lockfile, rootNames) {
  const collected = new Map()
  const missing = []
  const queue = rootNames.map((name) => ({
    name,
    lockDir: API_LOCK_DIR,
    fromDir: apiDir,
    direct: true,
  }))
  while (queue.length > 0) {
    const item = queue.shift()
    const lockKey = findLockKey(lockfile, item.lockDir, item.name)
    if (!lockKey) {
      missing.push({
        check: CHECK_INSTALL,
        detail: `${item.name}, required from ${item.lockDir || 'the repository root'}, has no entry in ${LOCKFILE_PATH}`,
      })
      continue
    }
    if (collected.has(lockKey)) continue
    const lockEntry = lockfile.packages[lockKey]
    const record = inspectPackage(item, lockEntry, lockKey)
    collected.set(lockKey, record)
    if (!record.dir) continue
    for (const name of dependencyNames(lockEntry)) {
      queue.push({ name, lockDir: lockKey, fromDir: record.dir, direct: false })
    }
  }
  return { records: [...collected.values()], missing }
}

function findLicenceFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name))
    .map((entry) => describeLicenceFile(path.join(directory, entry.name)))
}

function describeLicenceFile(absolutePath) {
  const contents = fs.readFileSync(absolutePath)
  return {
    path: toRepoPath(absolutePath),
    bytes: contents.byteLength,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    firstLine: contents.toString('utf8').split('\n')[0].trim(),
  }
}

function describeArtifact(packageDir, modelFile, problems) {
  const absolutePath = path.join(packageDir, modelFile.path)
  const present = fs.existsSync(absolutePath)
  if (!present) {
    problems.push({
      check: CHECK_WEIGHTS,
      detail: `Model weight file ${modelFile.path} is missing from ${toRepoPath(packageDir)}`,
    })
  }
  return {
    path: modelFile.path,
    present,
    bytes: present ? fs.statSync(absolutePath).size : null,
  }
}

// Story 6.2b reads this sentence as the redistribution record, so it says what was found on disk
// and nothing more. A weights directory with its own licence file is a different situation from
// one covered only by the package licence, and neither may be reported as the other.
function weightLicenceBasis(weightLicenceFiles, licence) {
  if (!licence) {
    return 'The package declares no licence, so nothing states terms for redistributing the weight files.'
  }
  if (weightLicenceFiles.length > 0) {
    const paths = weightLicenceFiles.map((file) => file.path).join(', ')
    return `The weight files sit beside their own licence statement (${paths}), which has to be read alongside the package licence ${licence}.`
  }
  return `The weight files carry no licence statement of their own, so the package licence ${licence} is the only statement covering their redistribution.`
}

function clearModelWeights(manifest, record) {
  const problems = []
  if (!record?.dir) {
    problems.push({
      check: CHECK_WEIGHTS,
      detail: `${manifest.packageName} carries the model weights but was not resolved from the manifest dependency set`,
    })
    return { clearance: null, problems }
  }
  const foreign = manifest.modelFiles.filter(
    (file) => file.package !== manifest.packageName
  )
  for (const file of foreign) {
    problems.push({
      check: CHECK_WEIGHTS,
      detail: `Model weight file ${file.path} ships in ${file.package}, which this check does not clear; it clears ${manifest.packageName} only`,
    })
  }
  const owned = manifest.modelFiles.filter(
    (file) => file.package === manifest.packageName
  )
  const artifacts = owned.map((file) => describeArtifact(record.dir, file, problems))
  const weightDirs = [...new Set(owned.map((file) => path.posix.dirname(file.path)))]
  const weightLicenceFiles = weightDirs.flatMap((dir) =>
    findLicenceFiles(path.join(record.dir, dir))
  )
  return {
    clearance: buildClearance(manifest, record, artifacts, weightLicenceFiles, problems),
    problems,
  }
}

function buildClearance(manifest, record, artifacts, weightLicenceFiles, problems) {
  if (record.version !== manifest.packageVersion) {
    problems.push({
      check: CHECK_WEIGHTS,
      detail: `The manifest pins ${manifest.packageName}@${manifest.packageVersion} but ${record.version} is installed, so the licence read here is not the pinned release's`,
    })
  }
  // A compound expression means the redistribution terms depend on which branch is taken, and
  // that choice belongs to a person, so only a single reviewed identifier clears automatically.
  const cleared = isReviewedIdentifier(record.license)
  if (!cleared) {
    problems.push({
      check: CHECK_WEIGHTS,
      detail: `${manifest.packageName} declares ${record.license ?? 'no licence'}, which does not clear redistribution of the model weights on its own`,
    })
  }
  return {
    package: manifest.packageName,
    version: record.version,
    license: record.license,
    licenseSource: record.licenseSource,
    resolvedFrom: record.resolvedFrom,
    packageLicenseFiles: findLicenceFiles(record.dir),
    weightLicenseFiles: weightLicenceFiles,
    weightLicenseBasis: weightLicenceBasis(weightLicenceFiles, record.license),
    artifacts,
    redistributionCleared: cleared,
  }
}

function summarizeChecks(problems, packageCount, artifactCount) {
  const counted = {
    [CHECK_LICENCES]: `${packageCount} packages`,
    [CHECK_INSTALL]: `${packageCount} packages`,
    [CHECK_WEIGHTS]: `${artifactCount} weight files`,
  }
  return CHECK_NAMES.map((name) => {
    const failures = problems.filter((problem) => problem.check === name)
    return {
      name,
      status: failures.length === 0 ? 'pass' : 'fail',
      measured: counted[name],
      failures: failures.map((failure) => failure.detail),
    }
  })
}

function buildEvidence(manifest, records, clearance, checks) {
  return {
    evidence: 'community-screening-supply-chain',
    producedBy: SCRIPT_PATH,
    generatedAt: new Date().toISOString(),
    scope:
      'Measurements only. Story 6.2b owns the release verdict that consumes this evidence.',
    manifest: {
      path: MANIFEST_PATH,
      manifestVersion: manifest.manifestVersion ?? null,
      modelFamily: manifest.modelFamily ?? null,
      packageName: manifest.packageName ?? null,
      packageVersion: manifest.packageVersion ?? null,
    },
    lockfile: LOCKFILE_PATH,
    packages: records.map((record) => ({
      name: record.name,
      installedName: record.installedName,
      version: record.version,
      license: record.license,
      licenseSource: record.licenseSource,
      lockPath: record.lockPath,
      resolvedFrom: record.resolvedFrom,
      direct: record.direct,
    })),
    modelWeights: clearance,
    checks,
  }
}

function printPackages(records) {
  const directCount = records.filter((record) => record.direct).length
  console.log(
    `Packages under review: ${records.length} (${directCount} direct, ${records.length - directCount} transitive).`
  )
  for (const record of records) {
    const identity = `${record.name}@${record.version ?? 'unresolved'}`
    console.log(
      `  ${identity.padEnd(42)} ${(record.license ?? 'none').padEnd(14)} ${record.resolvedFrom ?? record.lockPath}`
    )
  }
}

function printModelWeights(clearance) {
  console.log('')
  if (!clearance) {
    console.log('Model weights: not inspected, the carrying package did not resolve.')
    return
  }
  console.log(
    `Model weights: ${clearance.package} ${clearance.version} declares ${clearance.license ?? 'no licence'} in its ${clearance.licenseSource} field.`
  )
  for (const file of clearance.packageLicenseFiles) {
    console.log(
      `  Package licence file: ${file.path}, ${file.bytes} bytes, "${file.firstLine}".`
    )
  }
  for (const artifact of clearance.artifacts) {
    const size = artifact.present ? `${artifact.bytes} bytes` : 'MISSING'
    console.log(`  Artifact: ${artifact.path} (${size}).`)
  }
  console.log(`  ${clearance.weightLicenseBasis}`)
  console.log(
    `  Redistribution cleared: ${clearance.redistributionCleared ? 'yes' : 'no'}.`
  )
}

function printSummary(evidence) {
  console.log(`Supply-chain evidence from ${SCRIPT_PATH}.`)
  console.log(
    `Manifest: ${MANIFEST_PATH} (${evidence.manifest.packageName} ${evidence.manifest.packageVersion}, ${evidence.manifest.modelFamily}).`
  )
  console.log(`Lockfile: ${LOCKFILE_PATH}.`)
  console.log('')
  printPackages(evidence.packages)
  printModelWeights(evidence.modelWeights)
  console.log('')
  for (const check of evidence.checks) {
    console.log(`Check ${check.name}: ${check.status} over ${check.measured}.`)
  }
  console.log(`Collected at ${evidence.generatedAt}. ${evidence.scope}`)
}

function reportFailures(checks) {
  for (const check of checks) {
    for (const failure of check.failures) {
      console.error(`[${check.name}] ${failure}`)
    }
  }
}

async function main() {
  const manifest = readRequiredJson(MANIFEST_PATH)
  const lockfile = readRequiredJson(LOCKFILE_PATH)
  const rootNames = Object.keys(manifest.dependencies ?? {})
  if (rootNames.length === 0 || !Array.isArray(manifest.modelFiles)) {
    console.error(`${MANIFEST_PATH} declares no dependencies or no model files.`)
    process.exit(1)
  }

  const { records, missing } = collectPackages(lockfile, rootNames)
  records.sort((left, right) => left.lockPath.localeCompare(right.lockPath))
  const byName = new Map()
  for (const record of records) {
    if (!byName.has(record.name)) byName.set(record.name, record)
  }

  const weights = clearModelWeights(manifest, byName.get(manifest.packageName))
  const problems = [
    ...missing,
    ...records.flatMap((record) => record.problems),
    ...weights.problems,
  ]
  const checks = summarizeChecks(
    problems,
    records.length,
    weights.clearance?.artifacts.length ?? 0
  )
  const evidence = buildEvidence(manifest, records, weights.clearance, checks)

  if (emitJson) {
    console.log(JSON.stringify(evidence, null, 2))
  } else {
    printSummary(evidence)
  }
  reportFailures(checks)

  if (problems.length > 0) {
    console.error(`❌ ${problems.length} supply-chain findings need review.`)
    process.exit(1)
  }
  if (!emitJson) {
    console.log('✅ Every supply-chain check passed.')
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Supply-chain verification error:', err)
  process.exit(1)
})
