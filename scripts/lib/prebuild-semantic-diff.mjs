// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Compares two generated native trees (ios/ and android/ from `expo prebuild`) under a rule
// fixed before the comparison runs (story 6.15 D4, CX-14):
// - `project.pbxproj` is compared after normalizing only its 24-character object IDs, which
//   prebuild generates at random on every run, and sorting its lines, since Xcode orders
//   sections by those IDs;
// - JSON property files may differ only by the exact deletions the caller allows;
// - every other file must be byte-identical, and both trees must hold the same files;
// - the effective settings the caller names must hold in the second tree.
import fs from 'node:fs'
import path from 'node:path'

const PBXPROJ = /(^|\/)project\.pbxproj$/
const OBJECT_ID = /\b[0-9A-F]{24}\b/g

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

function normalizedPbxproj(text) {
  return text.replace(OBJECT_ID, 'ID').split('\n').sort().join('\n')
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
function compareFile(file, before, after, allowed) {
  if (before.equals(after)) return 'identical'
  if (PBXPROJ.test(file)) {
    const same =
      normalizedPbxproj(before.toString('utf8')) ===
      normalizedPbxproj(after.toString('utf8'))
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
    const outcome = compareFile(
      file,
      fs.readFileSync(path.join(beforeRoot, file)),
      fs.readFileSync(path.join(afterRoot, file)),
      allowed
    )
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
