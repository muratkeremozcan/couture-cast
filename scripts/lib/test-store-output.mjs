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

const variantPairs = (needles) =>
  needles
    .filter(Boolean)
    .flatMap((needle) =>
      needleVariants(needle).map((variant) => [variant, String(needle)])
    )

/** The needles `text` holds in any form, each once. */
export function leaksInText(text, needles) {
  const wanted = variantPairs(needles)
  return [
    ...new Set(wanted.filter(([variant]) => text.includes(variant)).map(([, n]) => n)),
  ]
}

/** Every file under `dir` whose contents hold one of `needles` in any form: [{ file, needle }]. */
export function scanForLeaks(dir, needles) {
  const hits = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else {
        const text = fs.readFileSync(file).toString('latin1')
        for (const needle of leaksInText(text, needles))
          hits.push({ file: path.relative(dir, file), needle })
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return hits
}

/**
 * Throws, naming files but never the ids, when the evidence dir holds any of `needles`. A file
 * that leaks is first moved into `<private>/quarantine/`, so an always-run upload of the
 * evidence dir never carries it (Antigravity r13 P2).
 */
export function assertEvidenceClean(dirs, needles) {
  const files = [...new Set(scanForLeaks(dirs.evidence, needles).map((hit) => hit.file))]
  if (!files.length) return
  for (const file of files) {
    const target = privatePath(dirs, path.join('quarantine', file))
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    fs.renameSync(path.join(dirs.evidence, file), target)
  }
  throw new JourneyError('test_store_evidence_leak', files.join(', '))
}

/**
 * The run's closing writes. The member side file goes to the private dir; the report is
 * serialized and scanned in memory, and reaches the evidence dir only when it holds no id in any
 * form; then the whole evidence dir is scanned. Returns the written paths.
 */
export function writeRunOutputs({ dirs, label, report, member, extraIds = [] }) {
  const needles = [member?.userId, ...extraIds]
  const written = {}
  if (member)
    written.member = writePrivate(dirs, `${label}.member.json`, { userId: member.userId })
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (leaksInText(text, needles).length)
    throw new JourneyError('test_store_evidence_leak', `${label}.json (not written)`)
  written.report = writeEvidence(dirs, `${label}.json`, text)
  assertEvidenceClean(dirs, needles)
  return written
}
