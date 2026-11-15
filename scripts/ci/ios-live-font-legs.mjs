// Story 6.15 AC3 on iOS: the live font-scale proof runs one screen per ios-live-font leg. With the
// XCUITest runner kept for the whole run a capture costs about 3.5 minutes (dispatches
// 43740466527 and 43746880534: about 37 Maestro calls a capture, 19 captures a screen), so the
// four screens take 4 to 5 hours on one runner and about 70 minutes each on their own. Each leg
// uploads its proof as ios-live-font-proof-<screen>; ios-live-font-evidence downloads them all and
// `merge` fails unless every screen reported exactly itself, on iOS, with a passing verdict.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The screens of the iOS proof, one ios-live-font leg each, in matrix order. */
export const LIVE_FONT_SCREENS = Object.freeze([
  'home',
  'community',
  'settings',
  'composer',
])
export const LIVE_FONT_ARTIFACT_PREFIX = 'ios-live-font-proof-'
export const LIVE_FONT_REPORT = 'live-font-report.json'

/** One leg's report, or why it proves nothing for `screen`. */
export function legVerdict(screen, text) {
  if (text === null) return { screen, pass: false, reasons: ['no live font report'] }
  let report
  try {
    report = JSON.parse(text)
  } catch {
    return { screen, pass: false, reasons: ['report is no JSON'] }
  }
  const reasons = []
  const screens = (report?.results ?? []).map((result) => result?.screen)
  if (report?.platform !== 'ios') reasons.push(`platform ${report?.platform}`)
  if (JSON.stringify(screens) !== JSON.stringify([screen]))
    reasons.push(`screens ${screens.join(',') || 'none'}`)
  if (report?.verdict?.pass !== true)
    reasons.push(...(report?.verdict?.reasons ?? ['no passing verdict']).map(String))
  return {
    screen,
    pass: reasons.length === 0,
    wallSeconds: Number.isFinite(report?.wallSeconds) ? report.wallSeconds : null,
    reasons,
  }
}

/**
 * Every leg under `directory` (download-artifact's one folder per artifact), in matrix order. A
 * leg without its artifact or its report fails, so a skipped or killed leg cannot pass the run.
 */
export function mergeLiveFontLegs(
  directory,
  read = (file) => fs.readFileSync(file, 'utf8')
) {
  const legs = LIVE_FONT_SCREENS.map((screen) => {
    let text
    try {
      text = read(
        path.join(directory, `${LIVE_FONT_ARTIFACT_PREFIX}${screen}`, LIVE_FONT_REPORT)
      )
    } catch {
      text = null
    }
    return legVerdict(screen, text)
  })
  return { pass: legs.every((leg) => leg.pass), legs }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  const [action, directory] = process.argv.slice(2)
  if (action !== 'merge' || !directory) {
    console.error('usage: ios-live-font-legs.mjs merge <directory>')
    process.exit(2)
  }
  const merged = mergeLiveFontLegs(directory)
  console.log(JSON.stringify({ iosLiveFontLegs: merged }))
  for (const leg of merged.legs)
    if (!leg.pass)
      console.error(`::error::live font ${leg.screen}: ${leg.reasons.join('; ')}`)
  process.exitCode = merged.pass ? 0 : 1
}
