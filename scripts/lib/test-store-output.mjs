// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 (TEA hardening, 2026-11-13): where the Test Store journey writes. The evidence
// dir (--out) holds redacted records only: the report, the manifests. Everything raw goes to a
// sibling private dir, `<out>.private/` (mode 700, files 600): the member side file, Metro's
// log, the device log (logcat or the simulator's log stream, which can carry the RevenueCat app
// user id, our user id), Maestro's debug output and any APK pulled off the device. The run
// fails if any member, app user or subscriber id is found anywhere under the evidence dir.
import fs from 'node:fs'
import path from 'node:path'
import { JourneyError } from './test-store-journey.mjs'

/** Creates both dirs; returns { evidence, private }. */
export function outputDirs(out) {
  const evidence = path.resolve(out)
  const dirs = { evidence, private: `${evidence}.private` }
  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.chmodSync(dir, 0o700)
  }
  return dirs
}

/** A path inside the private dir. */
export const privatePath = (dirs, name) => path.join(dirs.private, name)

const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    file,
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 }
  )
  return file
}

export const writeEvidence = (dirs, name, value) =>
  write(path.join(dirs.evidence, name), value)
export const writePrivate = (dirs, name, value) => write(privatePath(dirs, name), value)

/**
 * Base64 and base64url substrings that any encoding of `text` inside a larger byte run must
 * contain, at each of the three byte alignments (a user id inside a JWT payload, for one).
 */
export function base64Fragments(text) {
  const bytes = Buffer.from(text, 'utf8')
  const fragments = []
  for (let offset = 0; offset < 3; offset += 1) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString('base64')
    const n = offset + bytes.length
    // Characters whose six bits come from the id's bytes alone.
    const fragment = encoded.slice(Math.ceil((offset * 4) / 3), Math.floor((n * 4) / 3))
    fragments.push(fragment, fragment.replaceAll('+', '-').replaceAll('/', '_'))
  }
  return fragments
}

const unicodeEscape = (text, upper) =>
  [...text]
    .map((char) => {
      const hex = char.charCodeAt(0).toString(16).padStart(4, '0')
      return `\\u${upper ? hex.toUpperCase() : hex}`
    })
    .join('')

/**
 * The forms an id can take in a file (Antigravity r12 P2): raw, URL-encoded once and twice, lower
 * and upper case, base64 and base64url at every alignment, and JSON `\\u` escapes.
 */
export function needleVariants(needle) {
  const raw = String(needle)
  const once = encodeURIComponent(raw)
  return [
    ...new Set([
      raw,
      raw.toLowerCase(),
      raw.toUpperCase(),
      once,
      encodeURIComponent(once),
      ...base64Fragments(raw),
      unicodeEscape(raw, false),
      unicodeEscape(raw, true),
    ]),
  ].filter((variant) => variant.length >= 8)
}

/** Every file under `dir` whose contents hold one of `needles` in any form: [{ file, needle }]. */
export function scanForLeaks(dir, needles) {
  const wanted = needles
    .filter(Boolean)
    .flatMap((needle) =>
      needleVariants(needle).map((variant) => [variant, String(needle)])
    )
  const hits = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else {
        const text = fs.readFileSync(file).toString('latin1')
        const found = new Set(
          wanted.filter(([variant]) => text.includes(variant)).map(([, needle]) => needle)
        )
        for (const needle of found) hits.push({ file: path.relative(dir, file), needle })
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return hits
}

/** Throws, naming files but never the ids, when the evidence dir holds any of `needles`. */
export function assertEvidenceClean(dirs, needles) {
  const hits = scanForLeaks(dirs.evidence, needles)
  if (hits.length)
    throw new JourneyError(
      'test_store_evidence_leak',
      [...new Set(hits.map((hit) => hit.file))].join(', ')
    )
}

/**
 * The run's closing writes: the redacted report to the evidence dir, the member side file to
 * the private dir, then the leak scan over the evidence dir. Returns the written paths.
 */
export function writeRunOutputs({ dirs, label, report, member, extraIds = [] }) {
  const written = { report: writeEvidence(dirs, `${label}.json`, report) }
  if (member)
    written.member = writePrivate(dirs, `${label}.member.json`, { userId: member.userId })
  assertEvidenceClean(dirs, [member?.userId, ...extraIds])
  return written
}
