// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Compares two generated native trees (ios/ and android/ from `expo prebuild`) under a rule
// fixed before the comparison runs (story 6.15 D4, CX-14, R2-02):
// - `project.pbxproj` is parsed and compared by structure. Prebuild draws its 24-character object
//   IDs at random on every run, so each object is labelled by its own fields with every reference
//   replaced by the label of the object it points to, refined until stable. Two projects match
//   when they hold the same multiset of labels and the same root label: renamed IDs match, while
//   a retargeted reference or a reordered array (build phases, configurations) does not;
// - JSON property files may differ only by the exact deletions the caller allows;
// - every other file must be byte-identical, and both trees must hold the same files;
// - the effective settings the caller names must hold in the second tree.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const xcode = createRequire(import.meta.url)('xcode')
const PBXPROJ = /(^|\/)project\.pbxproj$/

function listFiles(root) {
  const files = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return files.sort()
}

function parsePbxproj(file) {
  const project = xcode.project(file)
  project.parseSync()
  const objects = new Map()
  for (const section of Object.values(project.hash.project.objects))
    for (const [id, object] of Object.entries(section))
      if (!id.endsWith('_comment')) objects.set(id, object)
  // Every top-level field besides the object table and the root reference (archiveVersion,
  // objectVersion, classes, and anything a future format adds) is compared exactly (R3-04).
  const header = Object.fromEntries(
    Object.entries(project.hash.project).filter(
      ([key]) => key !== 'objects' && key !== 'rootObject'
    )
  )
  return {
    objects,
    root: project.hash.project.rootObject,
    header: canonicalJson(header),
    headComment: project.hash.headComment ?? null,
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !key.endsWith('_comment'))
        .sort()
        .map((key) => [key, canonicalJson(value[key])])
    )
  return value
}

const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Labels every object by its content and, through references, by the objects it reaches. */
function structuralLabels({ objects, root, header, headComment }) {
  const encode = (value, label) => {
    if (typeof value === 'string') return objects.has(value) ? `@${label(value)}` : value
    if (Array.isArray(value)) return value.map((item) => encode(item, label))
    // Array entries parse as { value, comment }; the comment is a display name.
    if (
      value &&
      typeof value === 'object' &&
      'value' in value &&
      Object.keys(value).length <= 2
    )
      return encode(value.value, label)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .filter((key) => !key.endsWith('_comment'))
          .sort()
          .map((key) => [key, encode(value[key], label)])
      )
    return value
  }
  let labels = new Map([...objects.keys()].map((id) => [id, 'object']))
  let distinct = 1
  for (let round = 0; round <= objects.size; round += 1) {
    const next = new Map(
      [...objects].map(([id, object]) => [
        id,
        digest(JSON.stringify(encode(object, (target) => labels.get(target)))),
      ])
    )
    const count = new Set(next.values()).size
    labels = next
    if (round > 0 && count === distinct) break
    distinct = count
  }
  return {
    header: JSON.stringify({ header, headComment }),
    multiset: [...labels.values()].sort(),
    root: root === undefined ? null : (labels.get(root) ?? encode(root, () => null)),
  }
}

function samePbxproj(beforeFile, afterFile) {
  let before
  let after
  try {
    before = structuralLabels(parsePbxproj(beforeFile))
    after = structuralLabels(parsePbxproj(afterFile))
  } catch {
    return false
  }
  return (
    before.header === after.header &&
    before.root === after.root &&
    JSON.stringify(before.multiset) === JSON.stringify(after.multiset)
  )
}

function jsonDifference(file, before, after, allowed) {
  const a = JSON.parse(before)
  const b = JSON.parse(after)
  const permitted = allowed.filter((rule) => rule.file === file)
  const problems = []
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue
    const deletion = permitted.find(
      (rule) =>
        rule.key === key &&
        !(key in b) &&
        JSON.stringify(a[key]) === JSON.stringify(rule.value)
    )
    if (!deletion) problems.push(`${file}: ${key} changed`)
  }
  return problems
}

function readProperties(text) {
  const values = {}
  for (const line of text.split('\n')) {
    const match = /^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return values
}

/** One file present in both trees: 'identical', 'normalized', or a list of problems. */
function compareFile(file, roots, allowed) {
  const before = fs.readFileSync(path.join(roots.before, file))
  const after = fs.readFileSync(path.join(roots.after, file))
  if (before.equals(after)) return 'identical'
  if (PBXPROJ.test(file)) {
    const same = samePbxproj(path.join(roots.before, file), path.join(roots.after, file))
    return same ? 'normalized' : [`${file}: differs beyond object IDs`]
  }
  if (file.endsWith('.json') && allowed.some((entry) => entry.file === file))
    return jsonDifference(file, before.toString('utf8'), after.toString('utf8'), allowed)
  return [`${file}: differs`]
}

function effectiveProblems(afterRoot, checks) {
  const problems = []
  for (const check of checks) {
    const full = path.join(afterRoot, check.file)
    if (!fs.existsSync(full)) {
      problems.push(`${check.file}: missing for effective setting ${check.key}`)
      continue
    }
    const text = fs.readFileSync(full, 'utf8')
    const value = (check.format === 'json' ? JSON.parse(text) : readProperties(text))[
      check.key
    ]
    if (check.equals !== undefined && value !== check.equals)
      problems.push(`${check.file}: ${check.key} is ${value}, expected ${check.equals}`)
    if (check.notEquals !== undefined && value === check.notEquals)
      problems.push(`${check.file}: ${check.key} must not be ${check.notEquals}`)
  }
  return problems
}

/**
 * @param {string} beforeRoot directory holding the first prebuild's ios/ and android/
 * @param {string} afterRoot directory holding the second prebuild's ios/ and android/
 * @param {{ allowedDeletions?: { file: string, key: string, value: unknown }[],
 *   effective?: { file: string, format: 'properties' | 'json', key: string,
 *     equals?: string, notEquals?: string }[] }} rule
 */
export function comparePrebuilds(beforeRoot, afterRoot, rule = {}) {
  const allowed = rule.allowedDeletions ?? []
  const beforeFiles = listFiles(beforeRoot)
  const afterFiles = listFiles(afterRoot)
  const afterSet = new Set(afterFiles)
  const beforeSet = new Set(beforeFiles)
  const problems = [
    ...beforeFiles
      .filter((file) => !afterSet.has(file))
      .map((file) => `${file}: missing after`),
    ...afterFiles
      .filter((file) => !beforeSet.has(file))
      .map((file) => `${file}: added after`),
  ]
  const counts = { identical: 0, normalized: 0 }
  for (const file of beforeFiles.filter((name) => afterSet.has(name))) {
    const outcome = compareFile(file, { before: beforeRoot, after: afterRoot }, allowed)
    if (typeof outcome === 'string') counts[outcome] += 1
    else problems.push(...outcome)
  }
  problems.push(...effectiveProblems(afterRoot, rule.effective ?? []))
  return { files: beforeFiles.length, ...counts, problems }
}

/** The Story 6.15 Step 0 rule for deleting `newArchEnabled` and `edgeToEdgeEnabled`. */
export const APP_JSON_KEY_REMOVAL_RULE = {
  allowedDeletions: [
    { file: 'ios/Podfile.properties.json', key: 'newArchEnabled', value: 'true' },
  ],
  effective: [
    {
      file: 'android/gradle.properties',
      format: 'properties',
      key: 'newArchEnabled',
      equals: 'true',
    },
    {
      file: 'android/gradle.properties',
      format: 'properties',
      key: 'edgeToEdgeEnabled',
      equals: 'true',
    },
    {
      file: 'android/gradle.properties',
      format: 'properties',
      key: 'expo.edgeToEdgeEnabled',
      equals: 'true',
    },
    // ios/Podfile turns the New Architecture off only when this property is 'false'.
    {
      file: 'ios/Podfile.properties.json',
      format: 'json',
      key: 'newArchEnabled',
      notEquals: 'false',
    },
  ],
}
