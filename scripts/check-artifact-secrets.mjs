#!/usr/bin/env node
/**
 * Fails when a file about to be uploaded as a CI artifact contains the value of
 * a secret the job holds.
 *
 *   node scripts/check-artifact-secrets.mjs --names GUARDIAN_INVITE_JWT_SECRET,GH_TOKEN \
 *     blob-report playwright/playwright-report
 *
 * Names come from the workflow and values from this process's environment, so a
 * workflow step maps each secret it wants checked into the step's `env` and lists
 * its name. Output only ever carries a file path and a variable name: a value is
 * never printed, not even partially, because CI logs are as public as the
 * artifacts this protects.
 *
 * Playwright output is mostly containers, so a plain byte search would miss most
 * of it. Blob reports and traces are zip files, traces nest inside blob reports,
 * the HTML report embeds its data as a base64 zip inside index.html, and inline
 * attachments travel as base64 inside JSON lines. The scan therefore opens zip and
 * gzip data at any depth, decodes long base64 runs that turn out to hold an archive,
 * and searches every layer for the raw value plus its JSON-escaped, URL-encoded and
 * base64 forms. Base64 is matched at all three byte alignments, since a value
 * embedded in a longer string encodes differently depending on where it starts.
 *
 * A container that cannot be opened fails the scan. Uploading bytes the guard could
 * not read would be uploading bytes nobody checked.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

/** Values shorter than this match too much random data to scan for meaningfully. */
export const MIN_SECRET_LENGTH = 8

/** Real artifacts nest two or three archives deep; this only bounds a hostile file. */
const MAX_DEPTH = 8

/** Shorter base64 runs are ordinary identifiers and hashes, never an archive. */
const MIN_EMBEDDED_BASE64_LENGTH = 64

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const EMPTY_ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06])
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])
const BASE64_RUN = /[A-Za-z0-9+/_-]{64,}={0,2}/g

function startsWith(buffer, magic) {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic)
}

/**
 * The base64 characters that depend only on `text`'s own bytes when it sits at
 * `offset` bytes past a 3-byte boundary inside a longer encoded string.
 */
function base64Fragment(text, offset) {
  const bytes = Buffer.from(text, 'utf8')
  const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString('base64')
  const start = Math.ceil((offset * 8) / 6)
  const end = Math.floor(((offset + bytes.length) * 8) / 6)
  return encoded.slice(start, end)
}

/**
 * Every byte sequence that would betray `value` in an artifact, each labelled with
 * the encoding that produced it so a finding says how the value got there.
 */
export function secretEncodings(value) {
  const textForms = new Map([['raw', value]])
  const jsonEscaped = JSON.stringify(value).slice(1, -1)
  textForms.set('json-escaped', jsonEscaped)
  textForms.set('json-escaped-twice', JSON.stringify(jsonEscaped).slice(1, -1))
  textForms.set('url-encoded', encodeURIComponent(value))
  textForms.set(
    'html-escaped',
    value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
  )

  const needles = new Map()
  const add = (encoding, text) => {
    if (text.length > 0 && !needles.has(text)) needles.set(text, encoding)
  }
  for (const [form, text] of textForms) {
    add(form, text)
    for (const offset of [0, 1, 2]) {
      const fragment = base64Fragment(text, offset)
      add(`base64 of ${form}`, fragment)
      add(`base64url of ${form}`, fragment.replace(/\+/g, '-').replace(/\//g, '_'))
    }
  }
  return [...needles].map(([text, encoding]) => ({ encoding, bytes: Buffer.from(text) }))
}

/**
 * Reads the named variables from `env`. Unset and empty names are reported back so
 * the caller can say what it skipped; a value too short to scan is an error, since
 * silently skipping it would make the guard pass on exactly the value it was asked
 * to check.
 */
export function resolveSecrets(names, env = process.env) {
  const secrets = []
  const unset = []
  const tooShort = []
  for (const name of names) {
    const value = env[name]
    if (value === undefined || value.trim() === '') {
      unset.push(name)
      continue
    }
    if (value.trim().length < MIN_SECRET_LENGTH) {
      tooShort.push(name)
      continue
    }
    // Callers commonly trim before use, so the trimmed form is what reaches output.
    const values = [...new Set([value, value.trim()])]
    secrets.push({
      name,
      needles: values.flatMap((candidate) => secretEncodings(candidate)),
    })
  }
  return { secrets, unset, tooShort }
}

function searchLayer(buffer, location, secrets, findings) {
  for (const secret of secrets) {
    const hit = secret.needles.find((needle) => buffer.includes(needle.bytes))
    if (hit) findings.push({ location, name: secret.name, encoding: hit.encoding })
  }
}

function scanBuffer(buffer, location, secrets, state, depth) {
  state.layers += 1
  searchLayer(buffer, location, secrets, state.findings)
  if (depth >= MAX_DEPTH) return

  if (startsWith(buffer, ZIP_MAGIC) || startsWith(buffer, EMPTY_ZIP_MAGIC)) {
    let entries
    try {
      entries = unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length))
    } catch (error) {
      state.unreadable.push({ location, reason: `zip: ${error.message}` })
      return
    }
    for (const [entryName, data] of Object.entries(entries)) {
      scanBuffer(Buffer.from(data), `${location}!${entryName}`, secrets, state, depth + 1)
    }
    return
  }

  if (startsWith(buffer, GZIP_MAGIC)) {
    let inflated
    try {
      inflated = zlib.gunzipSync(buffer)
    } catch (error) {
      state.unreadable.push({ location, reason: `gzip: ${error.message}` })
      return
    }
    scanBuffer(inflated, `${location}!gunzip`, secrets, state, depth + 1)
    return
  }

  // An archive carried as base64 text: the HTML report's embedded data, or an
  // inline zip attachment inside a JSON line. Anything else that decodes is
  // already covered by the base64 needles.
  const text = buffer.toString('latin1')
  if (text.length < MIN_EMBEDDED_BASE64_LENGTH) return
  let index = 0
  for (const match of text.matchAll(BASE64_RUN)) {
    const decoded = Buffer.from(match[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (
      startsWith(decoded, ZIP_MAGIC) ||
      startsWith(decoded, EMPTY_ZIP_MAGIC) ||
      startsWith(decoded, GZIP_MAGIC)
    ) {
      index += 1
      scanBuffer(decoded, `${location}!base64[${index}]`, secrets, state, depth + 1)
    }
  }
}

function collectFiles(target, files, seen) {
  let stat
  try {
    stat = fs.statSync(target)
  } catch {
    return false
  }
  const real = fs.realpathSync(target)
  if (seen.has(real)) return true
  seen.add(real)
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target).sort()) {
      collectFiles(path.join(target, entry), files, seen)
    }
  } else if (stat.isFile()) {
    files.push(target)
  }
  return true
}

/**
 * Scans every file under `targets` for every secret. Missing targets are reported,
 * since upload steps tolerate absent paths too.
 */
export function scanPaths(targets, secrets) {
  const files = []
  const missing = []
  const seen = new Set()
  for (const target of targets) {
    if (!collectFiles(target, files, seen)) missing.push(target)
  }
  const state = { findings: [], unreadable: [], layers: 0 }
  for (const file of files) {
    scanBuffer(fs.readFileSync(file), file, secrets, state, 0)
  }
  return { files: files.length, missing, ...state }
}

export function parseArgs(argv) {
  const names = []
  const targets = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--names') {
      names.push(...(argv[index + 1] ?? '').split(/[\s,]+/))
      index += 1
    } else if (arg.startsWith('--names=')) {
      names.push(...arg.slice('--names='.length).split(/[\s,]+/))
    } else {
      targets.push(arg)
    }
  }
  return { names: [...new Set(names.filter(Boolean))], targets }
}

export function main(argv = process.argv.slice(2), env = process.env, out = console) {
  const { names, targets } = parseArgs(argv)
  if (names.length === 0 || targets.length === 0) {
    out.error('Usage: check-artifact-secrets.mjs --names NAME[,NAME...] <path>...')
    return 2
  }

  const { secrets, unset, tooShort } = resolveSecrets(names, env)
  if (tooShort.length > 0) {
    out.error(
      `Cannot scan for ${tooShort.join(', ')}: set but shorter than ${MIN_SECRET_LENGTH} ` +
        'characters, which would match unrelated bytes.'
    )
    return 2
  }
  if (unset.length > 0) out.log(`Not set in this job, skipped: ${unset.join(', ')}`)

  const result = scanPaths(targets, secrets)
  if (result.missing.length > 0)
    out.log(`Not present, skipped: ${result.missing.join(', ')}`)

  for (const { location, reason } of result.unreadable) {
    out.error(`Could not open ${location} to check it (${reason}).`)
  }
  for (const { location, name, encoding } of result.findings) {
    out.error(`Secret value of ${name} found in ${location} (${encoding}).`)
  }

  const scanned = secrets.map((secret) => secret.name).join(', ') || 'none'
  out.log(
    `Scanned ${result.files} file(s), ${result.layers} layer(s) in total, for: ${scanned}.`
  )
  if (result.findings.length > 0 || result.unreadable.length > 0) {
    out.error(
      'Refusing to upload: remove the secret from the output above before retrying.'
    )
    return 1
  }
  out.log('No secret values found.')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
