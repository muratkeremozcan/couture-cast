#!/usr/bin/env node
/**
 * The real-session artifact set: written raw outside the upload directory, redacted
 * into a staging directory, then published with a completion record.
 *
 *   node scripts/e2e-real-session/artifacts.mjs verify
 *
 * Playwright writes its JUnit and failure output to `<run dir>/raw`, never to the
 * upload directory. Finalization copies the raw output, the logs and the proof
 * files into `<run dir>/artifacts-staging`, redacts every text file there and drops
 * every binary one, moves the staging directory to `<run dir>/artifacts`, and only
 * then writes `<run dir>/artifacts-complete.json`: the SHA-256 of every published
 * file. `verify` passes only when that record exists and names exactly the files
 * the upload directory holds, byte for byte. A run killed or failing anywhere before
 * the record is written leaves no record, so CI uploads nothing.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RAW_DIR, redactSecrets, resolveHarnessDir } from './harness.mjs'

export { RAW_DIR }
export const STAGING_DIR = 'artifacts-staging'
export const ARTIFACTS_DIR = 'artifacts'
export const COMPLETION_RECORD = 'artifacts-complete.json'
export const ISSUED_OTPS_FILE = 'issued-otps.json'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(full) : [full]
  })
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** Every file under `directory`, by forward-slash relative path, with its SHA-256. */
export function hashTree(directory) {
  return Object.fromEntries(
    walkFiles(directory)
      .map((file) => [
        path.relative(directory, file).split(path.sep).join('/'),
        sha256(file),
      ])
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

/**
 * Removes the published set and its record, so nothing from an earlier run can be
 * uploaded for this one. The record goes first: without it nothing verifies.
 *
 * @param {string} directory
 */
export function resetArtifacts(directory) {
  fs.rmSync(path.join(directory, COMPLETION_RECORD), { force: true })
  fs.rmSync(path.join(directory, ISSUED_OTPS_FILE), { force: true })
  for (const folder of [ARTIFACTS_DIR, STAGING_DIR, RAW_DIR])
    fs.rmSync(path.join(directory, folder), { recursive: true, force: true })
  fs.mkdirSync(path.join(directory, RAW_DIR), { recursive: true, mode: 0o700 })
}

/**
 * Builds and publishes the redacted set. `sources` maps a path inside the published
 * set to a file or directory to copy there; `texts` adds generated files. `secrets`
 * are redacted from every text file; `otpCodes` must be among them, and are written
 * to the issued-OTP file for the scan. `redact` is the redaction pass, injectable so
 * a test can interrupt finalization midway.
 *
 * @param {{
 *   directory: string
 *   sources: readonly { to: string, from: string }[]
 *   texts?: readonly { to: string, content: string }[]
 *   secrets: readonly (string | undefined)[]
 *   otpCodes: readonly string[]
 *   redact?: (text: string, secrets: readonly (string | undefined)[]) => string
 * }} options
 */
export function finalizeArtifacts({
  directory,
  sources,
  texts = [],
  secrets,
  otpCodes,
  redact = redactSecrets,
}) {
  const record = path.join(directory, COMPLETION_RECORD)
  const staging = path.join(directory, STAGING_DIR)
  const published = path.join(directory, ARTIFACTS_DIR)
  fs.rmSync(record, { force: true })
  writeAtomically(
    path.join(directory, ISSUED_OTPS_FILE),
    `${JSON.stringify([...new Set(otpCodes)])}\n`
  )
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 })

  for (const { to, from } of sources) {
    if (!fs.existsSync(from)) continue
    const target = path.join(staging, to)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(from, target, { recursive: true })
  }
  for (const { to, content } of texts) {
    const target = path.join(staging, to)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  for (const file of walkFiles(staging)) {
    const bytes = fs.readFileSync(file)
    if (bytes.includes(0)) {
      // Binary output (a screenshot, a trace) cannot be redacted, so it is not kept.
      fs.rmSync(file)
      continue
    }
    fs.writeFileSync(file, redact(bytes.toString('utf8'), [...secrets, ...otpCodes]))
  }

  fs.rmSync(published, { recursive: true, force: true })
  fs.renameSync(staging, published)
  const files = hashTree(published)
  // Last, and atomic: a record exists only for a set that was fully published.
  writeAtomically(
    record,
    `${JSON.stringify({ completedAt: new Date().toISOString(), files }, null, 2)}\n`
  )
  return { files: Object.keys(files).length }
}

/** @param {string} file @param {string} content */
function writeAtomically(file, content) {
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, content, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * Whether the upload directory holds exactly the set the completion record names.
 *
 * @param {string} directory
 * @returns {{ ok: true, files: number } | { ok: false, reason: string }}
 */
export function verifyArtifacts(directory) {
  const record = path.join(directory, COMPLETION_RECORD)
  if (!fs.existsSync(record))
    return { ok: false, reason: 'no completion record: finalization did not finish' }
  let expected
  try {
    expected = JSON.parse(fs.readFileSync(record, 'utf8')).files
  } catch {
    return { ok: false, reason: 'the completion record is unreadable' }
  }
  if (!expected || typeof expected !== 'object')
    return { ok: false, reason: 'the completion record lists no files' }
  const actual = hashTree(path.join(directory, ARTIFACTS_DIR))
  const names = new Set([...Object.keys(expected), ...Object.keys(actual)])
  for (const name of names) {
    if (!Object.hasOwn(actual, name))
      return { ok: false, reason: 'a recorded file is missing' }
    if (!Object.hasOwn(expected, name))
      return { ok: false, reason: 'a file is not in the record' }
    if (actual[name] !== expected[name])
      return { ok: false, reason: 'a file changed after finalization' }
  }
  return { ok: true, files: names.size }
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command] = process.argv.slice(2)
  if (command !== 'verify') {
    console.error('Usage: artifacts.mjs verify')
    process.exit(2)
  }
  const result = verifyArtifacts(resolveHarnessDir(process.env, repoRoot))
  if (result.ok) {
    console.log(`[real-session] Artifact set verified: ${result.files} file(s).`)
  } else {
    // File names come from inside the run, so none is printed.
    console.error(`[real-session] Refusing to upload artifacts: ${result.reason}.`)
    process.exit(1)
  }
}
