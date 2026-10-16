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

/** The shortest base64 run decoded and rescanned: 18 bytes, a minimal gzip member. */
const MIN_EMBEDDED_BASE64_LENGTH = 24

/** A zip's end-of-central-directory record sits within this many trailing bytes. */
const EOCD_SEARCH_WINDOW = 22 + 0xffff

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const EMPTY_ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x05, 0x06])
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])
const BASE64_RUN = /[A-Za-z0-9+/_-]{24,}={0,2}/g

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

/**
 * Alternate spellings of one layer that the needles alone would miss: JSON whose
 * writer escaped characters as `\uXXXX`, and base64 wrapped across lines (real or
 * JSON-escaped newlines). Each is searched like the layer itself.
 */
function normalizedViews(text) {
  const views = []
  if (/\\u[0-9a-fA-F]{4}|\\\//.test(text)) {
    views.push({
      label: 'json-unescaped',
      text: text
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        )
        .replace(/\\\//g, '/'),
    })
  }
  if (/[\r\n]|\\[rn]/.test(text)) {
    views.push({ label: 'unwrapped', text: text.replace(/\r|\n|\\r|\\n/g, '') })
  }
  return views
}

/**
 * Archive entries in central-directory order, refusing names that would make two
 * entries share a slot: a duplicate name keeps only the last copy, and `__proto__`
 * never becomes an own property, so either would hide an entry from the scan.
 */
function zipEntries(buffer) {
  const names = []
  const entries = unzipSync(
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length),
    {
      filter: (file) => {
        names.push(file.name)
        return true
      },
    }
  )
  if (new Set(names).size !== names.length || names.includes('__proto__')) {
    // Marked so a zip found only by its trailing record still fails closed: it
    // opened, so it is a zip, and the ambiguity is real.
    throw Object.assign(new Error('duplicate or reserved entry names'), {
      ambiguous: true,
    })
  }
  return names.map((name) => entries[name])
}

/**
 * `gzip` and `zip` are certain from the first bytes, so failing to open them fails
 * the scan. `zip-suffix` is a zip found only by its trailing directory record, as
 * with a preamble before the first entry; random binary can contain that record by
 * chance, so a `zip-suffix` that does not open is scanned as plain bytes.
 */
function containerKind(buffer) {
  if (startsWith(buffer, GZIP_MAGIC)) return 'gzip'
  if (startsWith(buffer, ZIP_MAGIC) || startsWith(buffer, EMPTY_ZIP_MAGIC)) return 'zip'
  const tail = buffer.subarray(Math.max(0, buffer.length - EOCD_SEARCH_WINDOW))
  return tail.includes(EMPTY_ZIP_MAGIC) ? 'zip-suffix' : undefined
}

/** Short and opaque on purpose: entry names come from inside the artifact. */
function entryLabel(index, buffer) {
  const kind = containerKind(buffer)
  return kind ? `#${index}(${kind === 'gzip' ? 'gzip' : 'zip'})` : `#${index}`
}

/**
 * A zip behind a preamble either has offsets that count the preamble (what
 * appending to a file produces) or offsets relative to its first entry (what
 * concatenating produces). The first opens as is; the second opens from the first
 * local header.
 */
function zipEntriesAfterPreamble(buffer) {
  try {
    return zipEntries(buffer)
  } catch (error) {
    const start = buffer.indexOf(ZIP_MAGIC)
    if (start <= 0) throw error
    return zipEntries(buffer.subarray(start))
  }
}

/** The layers inside an archive. Throws when the archive cannot be read. */
function archiveChildren(buffer, kind) {
  if (kind === 'gzip') return [{ label: 'gunzip', data: zlib.gunzipSync(buffer) }]
  const entries = kind === 'zip' ? zipEntries(buffer) : zipEntriesAfterPreamble(buffer)
  return entries.map((entry, index) => {
    const data = Buffer.from(entry)
    return { label: `entry${entryLabel(index + 1, data)}`, data }
  })
}

/**
 * Searches the alternate spellings of a text layer, then returns every base64 run
 * it carries, decoded, as a layer of its own: the HTML report's embedded zip, an
 * attachment body inside a JSON line, or anything else. A decoded layer gets the
 * full treatment, so an escaped value inside an attachment is still found.
 */
function textChildren(buffer, location, secrets, state) {
  const text = buffer.toString('latin1')
  const views = normalizedViews(text)
  const notYetFound = () =>
    secrets.filter(
      (secret) =>
        !state.findings.some(
          (finding) =>
            finding.name === secret.name &&
            (finding.location === location || finding.location.startsWith(`${location}(`))
        )
    )
  for (const view of views) {
    // latin1 round-trips the original bytes; UTF-8 covers a `\uXXXX` escape
    // that decoded past one byte.
    for (const encoding of ['latin1', 'utf8']) {
      const layer = Buffer.from(view.text, encoding)
      searchLayer(layer, `${location}(${view.label})`, notYetFound(), state.findings)
    }
  }

  const runs = new Set()
  for (const candidate of [text, ...views.map((view) => view.text)]) {
    if (candidate.length < MIN_EMBEDDED_BASE64_LENGTH) continue
    for (const match of candidate.matchAll(BASE64_RUN)) runs.add(match[0])
  }
  return [...runs].map((run, index) => ({
    label: `base64#${index + 1}`,
    data: Buffer.from(run.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  }))
}

function scanBuffer(buffer, location, secrets, state, depth) {
  state.layers += 1
  searchLayer(buffer, location, secrets, state.findings)

  const kind = containerKind(buffer)
  let children
  if (kind) {
    try {
      children = archiveChildren(buffer, kind)
    } catch (error) {
      if (kind !== 'zip-suffix' || error.ambiguous) {
        state.unreadable.push({ location, reason: error.message })
        return
      }
    }
  }
  children ??= textChildren(buffer, location, secrets, state)

  if (children.length > 0 && depth >= MAX_DEPTH) {
    state.unreadable.push({ location, reason: `nested deeper than ${MAX_DEPTH} levels` })
    return
  }
  for (const child of children) {
    scanBuffer(child.data, `${location}!${child.label}`, secrets, state, depth + 1)
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
  for (const [index, file] of files.entries()) {
    // The name is uploaded too. One that carries a value is never printed: every
    // finding for that file is reported under its position instead.
    const nameHits = []
    searchLayer(Buffer.from(file), 'name', secrets, nameHits)
    const location = nameHits.length > 0 ? `file #${index + 1} of this scan` : file
    for (const hit of nameHits)
      state.findings.push({ ...hit, location: `${location}(name)` })
    let contents
    try {
      contents = fs.readFileSync(file)
    } catch (error) {
      state.unreadable.push({ location, reason: error.code ?? 'read failed' })
      continue
    }
    scanBuffer(contents, location, secrets, state, 0)
  }
  return { files: files.length, missing, ...state }
}

export function parseArgs(argv) {
  const names = []
  const storageStates = []
  const targets = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--names') {
      names.push(...(argv[index + 1] ?? '').split(/[\s,]+/))
      index += 1
    } else if (arg.startsWith('--names=')) {
      names.push(...arg.slice('--names='.length).split(/[\s,]+/))
    } else if (arg === '--storage-state') {
      storageStates.push(argv[index + 1] ?? '')
      index += 1
    } else if (arg.startsWith('--storage-state=')) {
      storageStates.push(arg.slice('--storage-state='.length))
    } else {
      targets.push(arg)
    }
  }
  return {
    names: [...new Set(names.filter(Boolean))],
    storageStates: storageStates.filter(Boolean),
    targets,
  }
}

/**
 * Credentials minted during the run rather than held as secrets: the cookies in a
 * Playwright storage-state file, such as the Vercel bypass cookie that global setup
 * exchanges VERCEL_AUTOMATION_BYPASS_SECRET for. Values too short to scan for are
 * flags, not credentials, and are left out.
 */
export function resolveStorageStateSecrets(files) {
  const secrets = []
  const missing = []
  for (const file of files) {
    if (!fs.existsSync(file)) {
      missing.push(file)
      continue
    }
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const cookie of state.cookies ?? []) {
      const value = String(cookie.value ?? '')
      if (value.trim().length < MIN_SECRET_LENGTH) continue
      secrets.push({ name: `cookie ${cookie.name}`, needles: secretEncodings(value) })
    }
  }
  return { secrets, missing }
}

export function main(argv = process.argv.slice(2), env = process.env, out = console) {
  const { names, storageStates, targets } = parseArgs(argv)
  if (names.length === 0 || targets.length === 0) {
    out.error(
      'Usage: check-artifact-secrets.mjs --names NAME[,NAME...] [--storage-state FILE] <path>...'
    )
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

  let minted
  try {
    minted = resolveStorageStateSecrets(storageStates)
  } catch {
    // The parser's message quotes the input, and the input is credentials.
    out.error(`Cannot read a storage-state file in ${storageStates.join(', ')} as JSON.`)
    return 2
  }
  if (minted.missing.length > 0) {
    out.log(`No storage state, skipped: ${minted.missing.join(', ')}`)
  }
  secrets.push(...minted.secrets)

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
