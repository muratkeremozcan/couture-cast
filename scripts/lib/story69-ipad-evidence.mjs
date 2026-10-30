// X-IPAD-ANCHOR evidence check (Story 6.9, AC5). The owner records one local iPad proof that the
// share sheet presents as a popover anchored to the Share button; this module validates the
// committed record and the screenshot it names. `record` writes a record from a real screenshot;
// it never invents one.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const IPAD_EVIDENCE_DIRECTORY = '_bmad-output/test-artifacts/story-6-9'
export const IPAD_EVIDENCE_RECORD = 'ipad-anchor-proof.json'
export const IPAD_EVIDENCE_TEST = 'X-IPAD-ANCHOR'
export const IPAD_ANCHORED_RESULT = 'anchored_to_share'
const KEYS = [
  'commit',
  'deviceClass',
  'environment',
  'osVersion',
  'recordedAt',
  'result',
  'screenshot',
  'test',
]
const SCREENSHOT_KEYS = ['file', 'sha256']
const text = (pattern) => (value) => typeof value === 'string' && pattern.test(value)
/** Each scalar field, its rule and the closed code it fails with. */
const FIELD_CHECKS = {
  test: (value) => value === IPAD_EVIDENCE_TEST,
  deviceClass: (value) => value === 'iPad',
  environment: (value) => ['simulator', 'device'].includes(value),
  osVersion: text(/^\d{2}(\.\d+){0,2}$/),
  commit: text(/^[0-9a-f]{40}$/),
  result: (value) => value === IPAD_ANCHORED_RESULT,
  recordedAt: (value) =>
    text(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)(value) &&
    !Number.isNaN(Date.parse(value)),
}
const FIELD_CODES = {
  test: 'ipad_evidence_test',
  deviceClass: 'ipad_evidence_device_class',
  environment: 'ipad_evidence_environment',
  osVersion: 'ipad_evidence_os_version',
  commit: 'ipad_evidence_commit',
  result: 'ipad_evidence_result',
  recordedAt: 'ipad_evidence_recorded_at',
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys)

/**
 * Returns the problems with the record in `directory`, as closed codes; an empty list passes.
 * The record has exactly the keys below, and its screenshot is a PNG committed beside it whose
 * SHA256 matches.
 */
export function ipadEvidenceProblems(directory) {
  const file = path.join(directory, IPAD_EVIDENCE_RECORD)
  if (!fs.existsSync(file)) return ['ipad_evidence_record_missing']
  let record
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return ['ipad_evidence_record_unreadable']
  }
  if (!exactKeys(record, KEYS)) return ['ipad_evidence_record_keys']
  const problems = Object.entries(FIELD_CHECKS)
    .filter(([key, valid]) => !valid(record[key]))
    .map(([key]) => FIELD_CODES[key])
  const shot = record.screenshot
  if (
    !exactKeys(shot, SCREENSHOT_KEYS) ||
    !text(/^[a-z0-9][a-z0-9._-]*\.png$/)(shot.file) ||
    !text(/^[0-9a-f]{64}$/)(shot.sha256)
  )
    return [...problems, 'ipad_evidence_screenshot_fields']
  const image = path.join(directory, shot.file)
  if (!fs.existsSync(image) || !fs.lstatSync(image).isFile())
    return [...problems, 'ipad_evidence_screenshot_missing']
  const bytes = fs.readFileSync(image)
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    problems.push('ipad_evidence_screenshot_not_png')
  if (createHash('sha256').update(bytes).digest('hex') !== shot.sha256)
    problems.push('ipad_evidence_screenshot_digest')
  return problems
}

/** Throws the first problem; returns the validated record. */
export function assertIpadEvidence(directory) {
  const problems = ipadEvidenceProblems(directory)
  if (problems.length) throw new Error(problems.join(','))
  return JSON.parse(fs.readFileSync(path.join(directory, IPAD_EVIDENCE_RECORD), 'utf8'))
}

/**
 * Writes the record for a screenshot that already sits in `directory`. The owner passes what the
 * proof observed; the commit defaults to the checkout's HEAD and the digest is computed.
 */
export function writeIpadEvidence(
  directory,
  { screenshot, osVersion, environment, commit, recordedAt = new Date().toISOString() }
) {
  const bytes = fs.readFileSync(path.join(directory, screenshot))
  const record = {
    test: IPAD_EVIDENCE_TEST,
    deviceClass: 'iPad',
    environment,
    osVersion,
    commit,
    result: IPAD_ANCHORED_RESULT,
    screenshot: {
      file: screenshot,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    recordedAt,
  }
  fs.writeFileSync(
    path.join(directory, IPAD_EVIDENCE_RECORD),
    JSON.stringify(record, null, 2) + '\n'
  )
  return assertIpadEvidence(directory)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const directory = path.join(root, IPAD_EVIDENCE_DIRECTORY)
  const argv = process.argv.slice(2)
  const option = (name) => {
    const at = argv.indexOf(`--${name}`)
    return at < 0 ? undefined : argv[at + 1]
  }
  try {
    if (argv[0] === 'record') {
      writeIpadEvidence(directory, {
        screenshot: option('screenshot'),
        osVersion: option('os'),
        environment: option('environment'),
        commit:
          option('commit') ??
          execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
          }).trim(),
      })
      console.log('X-IPAD-ANCHOR record written and verified.')
    } else if (argv.length === 0) {
      assertIpadEvidence(directory)
      console.log('X-IPAD-ANCHOR evidence verified.')
    } else throw new Error('ipad_evidence_action_invalid')
  } catch (error) {
    console.error(
      error.code === 'ENOENT' ? 'ipad_evidence_screenshot_missing' : error.message
    )
    process.exitCode = 1
  }
}
