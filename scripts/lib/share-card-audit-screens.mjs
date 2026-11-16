// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
//
// iOS 26.5 canary shard 3 failed ShareCardAccessibilityUITests on "Potentially inaccessible
// text" while preparing and left no picture of the screen. audit(_:) now attaches the screen to
// every issue it refuses, as `audit-failure-<state>`, and a failed audit run exports those
// attachments from its xcresult into the harness directory as `audit-failure-<state>.png`.
// scripts/e2e-share-card/public-evidence.mjs publishes only these fixed names, after the
// secret scan below.
import nodeFs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { EMAIL, LOCAL_PATH, SECRET_TEXT } from '../ci/native-ios-public-diagnostics.mjs'

/** Every state ShareCardAccessibilityUITests.audit(_:) is called with. */
export const AUDIT_STATES = Object.freeze([
  'denied',
  'limited',
  'offline',
  'open',
  'pending',
  'permanent-denied',
  'preparing',
  'saved',
  'storage-failure',
  'unavailable',
])
const STATE = AUDIT_STATES.join('|')
/** The screen run-story68-native.mjs takes itself after a failed audit, when the composer shows. */
export const NATIVE_AUDIT_SCREEN = 'native-ios-audit-failure.png'
/** The published name of each state's screen. */
export const AUDIT_SCREEN_FILE = new RegExp(`^audit-failure-(${STATE})\\.png$`)
/** xcresulttool names an attachment `<name>_<index>_<UUID>.<extension>`. */
const SUGGESTED_NAME = new RegExp(
  `^audit-failure-(${STATE})_\\d+_[0-9A-Fa-f-]{36}\\.png$`
)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/**
 * What public evidence never carries (PR 237 review P1): the secret, local path and email shapes
 * the public iOS diagnostics refuse (native-ios-public-diagnostics.mjs, URIs such as postgres://
 * included as paths), and the JWT, token and fixture account shapes public-evidence.mjs refuses
 * in its JSON.
 */
export const PRIVATE_TEXT = Object.freeze([
  SECRET_TEXT,
  LOCAL_PATH,
  EMAIL,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|access_token|refresh_token|service_role|@example\.test|@cc68\.test/i,
])
// The text chunks, and how much a compressed chunk (zTXt, iTXt, iCCP) may inflate to.
const TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt'])
const MAX_INFLATED = 1 << 20

const invalid = (detail) => {
  throw new Error(`invalid_audit_failure_screen:${detail}`)
}
const inflate = (bytes) => {
  try {
    return zlib.inflateSync(bytes, { maxOutputLength: MAX_INFLATED })
  } catch {
    return invalid('a compressed chunk does not inflate')
  }
}
/**
 * Runs of printable bytes, read as Latin-1 and as UTF-16 in both alignments, so UTF-16 text of
 * either byte order shows (eXIf, ICC profile mluc tags).
 */
const printableRuns = (data) =>
  [
    data.toString('latin1'),
    data.toString('utf16le'),
    data.subarray(1).toString('utf16le'),
  ].flatMap((view) => view.match(/[\x20-\x7e]{4,}/g) ?? [])

/**
 * The texts one metadata chunk can show a reader: a text chunk's keyword and text, inflated when
 * compressed (zTXt, compressed iTXt), an iCCP profile's name and the printable runs of its
 * inflated profile (PR 237 review), and any other chunk's printable runs (eXIf, as real XCUITest
 * and simctl screenshots carry).
 */
function chunkTexts(type, data) {
  if (type === 'iCCP') {
    // Profile name, null, compression method (0, deflate), compressed profile.
    const nameEnd = data.indexOf(0)
    if (nameEnd < 1) invalid('iCCP has no profile name')
    if (data[nameEnd + 1] !== 0) invalid('iCCP is not deflate')
    return [
      data.toString('latin1', 0, nameEnd),
      ...printableRuns(inflate(data.subarray(nameEnd + 2))),
    ]
  }
  if (TEXT_CHUNKS.has(type)) {
    const keywordEnd = data.indexOf(0)
    if (keywordEnd < 1) invalid(`${type} has no keyword`)
    const keyword = data.toString('latin1', 0, keywordEnd)
    if (type === 'tEXt') return [keyword, data.toString('latin1', keywordEnd + 1)]
    if (type === 'zTXt') {
      if (data[keywordEnd + 1] !== 0) invalid('zTXt is not deflate')
      return [keyword, inflate(data.subarray(keywordEnd + 2)).toString('latin1')]
    }
    // iTXt: keyword, compression flag and method, language tag, translated keyword, text.
    const [flag, method] = [data[keywordEnd + 1], data[keywordEnd + 2]]
    if (flag > 1 || (flag === 1 && method !== 0)) invalid('iTXt compression')
    const languageEnd = data.indexOf(0, keywordEnd + 3)
    const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1)
    if (translatedEnd < 0) invalid('iTXt is cut short')
    const text = data.subarray(translatedEnd + 1)
    return [
      keyword,
      data.toString('latin1', keywordEnd + 3, languageEnd),
      data.toString('utf8', languageEnd + 1, translatedEnd),
      (flag ? inflate(text) : text).toString('utf8'),
    ]
  }
  return printableRuns(data)
}

/**
 * The PNG's chunks (PR 237 review P1): the signature, IHDR first and 13 bytes long, every chunk
 * whole with its CRC, at least one IDAT, and IEND last, ending the file. Anything else throws
 * invalid_audit_failure_screen.
 */
function pngChunks(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    invalid('no PNG signature')
  const chunks = []
  let at = 8
  while (at < bytes.length && chunks.at(-1)?.type !== 'IEND') {
    const next = readChunk(bytes, at)
    chunks.push(next)
    at = next.end
  }
  if (chunks[0]?.type !== 'IHDR' || chunks[0].data.length !== 13)
    invalid('IHDR is not first')
  if (!chunks.some(({ type }) => type === 'IDAT')) invalid('no IDAT')
  if (chunks.at(-1)?.type !== 'IEND' || chunks.at(-1).data.length !== 0)
    invalid('no IEND')
  if (at !== bytes.length) invalid('bytes after IEND')
  return chunks
}

/** The chunk at `at`: whole, of a PNG chunk type, with a matching CRC. */
function readChunk(bytes, at) {
  if (at + 12 > bytes.length) invalid('a chunk is cut short')
  const length = bytes.readUInt32BE(at)
  const end = at + 12 + length
  if (length > 0x7fffffff || end > bytes.length) invalid('a chunk is cut short')
  const type = bytes.toString('latin1', at + 4, at + 8)
  if (!/^[A-Za-z]{4}$/.test(type)) invalid('a chunk type is not a PNG chunk type')
  if (zlib.crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
    invalid(`${type} fails its CRC`)
  return { type, data: bytes.subarray(at + 8, end - 4), end }
}

/**
 * Throws unless `bytes` is a whole PNG none of whose metadata shows private text. Pixels (IDAT)
 * are compressed image data, never text; every other chunk is read as chunkTexts reads it.
 */
export function assertPublicAuditScreen(bytes) {
  for (const { type, data } of pngChunks(bytes)) {
    if (type === 'IDAT') continue
    for (const text of chunkTexts(type, data))
      if (PRIVATE_TEXT.some((pattern) => pattern.test(text)))
        throw new Error('private_data_in_public_evidence')
  }
}

/**
 * Removes the screens an earlier audit run left, the harness's own screen of the failed audit
 * (native-ios-audit-failure.png) included, so a reused runtime cannot republish them.
 */
export function clearAuditScreens(directory, fs = nodeFs) {
  for (const name of fs.readdirSync(directory))
    if (AUDIT_SCREEN_FILE.test(name) || name === NATIVE_AUDIT_SCREEN)
      fs.rmSync(path.join(directory, name), { force: true })
}

/**
 * Exports the `audit-failure-<state>` screenshots of the failed audit run `result` into
 * `directory` as `audit-failure-<state>.png`, the earliest one of each state, and returns the
 * states written. `run(binary, args)` runs one command and throws on a failure. The export goes
 * to a private folder beside them, removed afterwards; anything that is not such a PNG stays
 * there.
 */
export function exportAuditScreens({ result, directory, run, fs = nodeFs }) {
  const exported = path.join(directory, `.audit-attachments-${process.pid}`)
  fs.rmSync(exported, { recursive: true, force: true })
  fs.mkdirSync(exported, { recursive: true })
  try {
    run('xcrun', [
      'xcresulttool',
      'export',
      'attachments',
      '--path',
      result,
      '--output-path',
      exported,
      '--filter',
      'audit-failure-*',
    ])
    const manifest = JSON.parse(
      fs.readFileSync(path.join(exported, 'manifest.json'), 'utf8')
    )
    const earliest = earliestScreens(manifest, exported, fs)
    // PR 237 review P2: every screen is read and checked before any is written, so one refused
    // screen publishes none, and any failure clears every screen the directory holds.
    try {
      const screens = [...earliest]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([state, { file }]) => {
          const bytes = fs.readFileSync(path.join(exported, file))
          assertPublicAuditScreen(bytes)
          return [state, bytes]
        })
      for (const [state, bytes] of screens)
        fs.writeFileSync(path.join(directory, `audit-failure-${state}.png`), bytes)
      return screens.map(([state]) => state)
    } catch (error) {
      clearAuditScreens(directory, fs)
      throw error
    }
  } finally {
    fs.rmSync(exported, { recursive: true, force: true })
  }
}

/**
 * The earliest attachment of each closed state in an export manifest: a PNG name in the export
 * folder itself, and a regular file there (PR 237 review P2). An attachment without a usable
 * timestamp sorts last, never first.
 */
function earliestScreens(manifest, exported, fs) {
  const earliest = new Map()
  for (const test of Array.isArray(manifest) ? manifest : [])
    for (const attachment of test?.attachments ?? []) {
      const state = SUGGESTED_NAME.exec(attachment?.suggestedHumanReadableName ?? '')?.[1]
      const file = attachment?.exportedFileName
      if (!state || !exportedPng(exported, file, fs)) continue
      const stamp = Number(attachment.timestamp)
      const at = Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY
      if (!earliest.has(state) || at < earliest.get(state).at)
        earliest.set(state, { at, file })
    }
  return earliest
}

const exportedPng = (exported, file, fs) =>
  typeof file === 'string' &&
  path.basename(file) === file &&
  /\.png$/i.test(file) &&
  fs.lstatSync(path.join(exported, file), { throwIfNoEntry: false })?.isFile() === true
