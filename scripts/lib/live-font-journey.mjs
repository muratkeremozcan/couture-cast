// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The live font-scale journey for one screen, with device IO injected so its order, coverage
// and verdicts are testable (Codex R4-03, R4-06, R4-07; TEA F-13, F-16, F-17).
//   1. Cold references: one fresh launch per scale in the sequence, each with the screen's
//      update made afterwards; a growth control for each scale above the base (F-01).
//   2. One live launch at the base scale walks the whole sequence (Android 1.0, 1.5, back to
//      1.0; iOS large, extra-extra-extra-large, accessibility-medium, back to large). Each leg
//      captures at once and when settled, makes the update, captures, reverts it, and the
//      reverted state is the next leg's `before`.
// The driver turns the report into an exit code with `aggregateVerdict`.
import fs from 'node:fs'
import path from 'node:path'

import { assertLiveProvenance, IOS_CONTENT_SIZES } from './live-font-capture.mjs'
import {
  assertColdControl,
  assertComposerControls,
  assertLiveFontProof,
  evaluateLiveFontChange,
  proposedResidualEntry,
  WEATHER_BANNER_MARKER,
} from './live-font-scale-proof.mjs'

const TABS = ['tab-home', 'tab-community', 'tab-settings']

/**
 * Screens, anchors, required controls and measured probes (size in sp, as styled). `volatile`
 * lists id prefixes the capture drops with their subtrees (see flattenHierarchy).
 */
export const SCREENS = {
  home: {
    flow: 'open-home',
    mount: 'home',
    anchors: ['current-temperature'],
    // Shop this look renders only from a network-served ritual, never from the 15-minute cache
    // (Decision 6), so whether a launch shows it depends on the cache's age, not on text size.
    volatile: ['shop-this-look-'],
    controls: TABS,
    probes: [
      { id: 'current-temperature', sizeSp: 48 },
      { id: 'current-condition', sizeSp: 14 },
    ],
  },
  community: {
    flow: 'open-community',
    mount: 'community',
    anchors: ['community-new-post-label'],
    // Feed and spotlight cards change between launches on their own: ranking, the climate pill
    // each card derives, and images that fail to load and show a retry. The filter chips sit in
    // a horizontal row that shows fewer chips as text grows (Cold and dry leaves the screen at
    // 1.5), so the row is left out too. The header, band notice and New post stay measured.
    volatile: [
      'community-post-card-',
      'community-spotlight',
      'community-sticky-filter-chips',
    ],
    // The band notice says the local forecast is out of date while the snapshot is over an hour
    // old; a residual entry approves only with the banner state it was approved with.
    bannerMarker: WEATHER_BANNER_MARKER,
    controls: TABS,
    probes: [{ id: 'community-new-post-label', sizeSp: 13 }],
  },
  settings: {
    flow: 'open-settings',
    mount: 'settings',
    anchors: ['settings-language-title'],
    controls: TABS,
    probes: [{ id: 'settings-language-title', sizeSp: 16 }],
  },
  composer: {
    flow: 'open-composer',
    // The composer's EdgeToEdgeModal carries the modal marker.
    mount: 'modal',
    anchors: ['share-card-title'],
    controls: ['share-card-save', 'share-card-share', 'share-card-cancel'],
    probes: [{ id: 'share-card-title', sizeSp: 26 }],
    composer: true,
  },
}

export const SCALES = {
  android: { base: '1', sequence: ['1.5', '1'] },
  ios: {
    base: 'large',
    sequence: ['extra-extra-extra-large', 'accessibility-medium', 'large'],
  },
}

export function numericScale(platform, scale) {
  return platform === 'android' ? Number(scale) : IOS_CONTENT_SIZES[scale]
}

/**
 * Save and Share minimum size in capture units: 44 pt on iOS as captured, 48 dp converted to
 * pixels on Android. Only Android asks for its density (R4-06).
 */
export function touchTarget(platform, androidDensity) {
  if (platform === 'ios') return 44
  const dpi = androidDensity()
  if (!(dpi > 0)) throw new Error('live_font_density_required')
  return Math.floor((48 * dpi) / 160)
}

function failure(error) {
  return {
    error: error.code ?? error.message?.split(':')[0] ?? 'live_font_failed',
    message: error.message,
  }
}

// A known residual with no entry approved for this run, in this environment, proposes one.
const UNAPPROVED = new Set([
  'live_font_residual_unapproved',
  'live_font_residual_environment_differs',
])

function judgeLeg({
  platform,
  reactNativeVersion,
  residualBaseline,
  timezone,
  weatherBanner,
  change,
}) {
  try {
    assertLiveProvenance({ ...change, platform })
    const result = assertLiveFontProof({
      reactNativeVersion,
      residualBaseline,
      timezone,
      weatherBanner,
      ...change,
    })
    return {
      pass: true,
      verdict: result.verdict,
      baselineReview: result.baselineReview,
      checks: result.checks,
    }
  } catch (error) {
    let evaluated
    try {
      evaluated = evaluateLiveFontChange(change)
    } catch {
      evaluated = {}
    }
    const leg = {
      pass: false,
      ...failure(error),
      verdict: evaluated.verdict ?? null,
      checks: evaluated.checks,
    }
    if (UNAPPROVED.has(leg.error) && leg.verdict === 'known-residual')
      leg.residualProposal = proposedResidualEntry(evaluated.checks, change)
    return leg
  }
}

function composerGeometry(platform, androidDensity, captures) {
  try {
    const minTarget = touchTarget(platform, androidDensity)
    return {
      pass: true,
      tiers: captures.map(
        (capture) =>
          assertComposerControls({ capture, window: capture.window, minTarget }).tier
      ),
    }
  } catch (error) {
    return { pass: false, ...failure(error) }
  }
}

/** The fields that name a residual entry: one entry per leg, run timezone and weather banner. */
const ENTRY_IDENTITY = [
  'platform',
  'build',
  'screen',
  'from',
  'to',
  'timezone',
  'weatherBanner',
]
const sameIdentity = (a, b) =>
  ENTRY_IDENTITY.every((field) => String(a[field]) === String(b[field]))

/**
 * The baseline entry that judges a leg: the one for its platform, build, screen, from, to,
 * timezone and weather banner. Without one, an entry for the same leg in another timezone or
 * banner state (in that order), so the leg reports live_font_residual_environment_differs and
 * proposes the entry for its own environment; undefined when the leg has no entry at all.
 */
export function residualBaselineFor(entries, leg) {
  const sameLeg = entries.filter((entry) =>
    ENTRY_IDENTITY.slice(0, 5).every(
      (field) => String(entry[field]) === String(leg[field])
    )
  )
  return (
    sameLeg.find((entry) => sameIdentity(entry, leg)) ??
    sameLeg.find((entry) => entry.timezone === leg.timezone) ??
    sameLeg[0]
  )
}

/**
 * Runs one screen's journey. `io` supplies: `cold(scale)` (fresh launch at the scale, settled,
 * with full text), `launch()`, `setScale(scale)`, `navigate()`, `capture(stage, scale)`,
 * `settle(stage, scale)` and `fullText(capture)` for the live launch, and `update()`/`revert()`.
 * `timezone` is the device timezone of the run and `weatherBanner` the banner state it set up; a
 * residual entry approves only in its own.
 */
export async function runScreenJourney({
  io,
  platform,
  androidApi,
  name,
  reactNativeVersion,
  residualBaselines = [],
  label,
  timezone,
  weatherBanner,
  androidDensity = () => undefined,
}) {
  const screen = SCREENS[name]
  if (!screen) throw new Error(`live_font_unknown_screen:${name}`)
  const { base, sequence } = SCALES[platform]
  const report = { screen: name, scales: [base, ...sequence], legs: [], controls: [] }
  try {
    const cold = {}
    for (const scale of [...new Set([base, ...sequence])]) {
      const reference = await io.cold(scale)
      await io.update()
      const updated = await io.fullText(await io.settle('cold', scale))
      // An update can persist (the Settings locale does), so undo it before the next launch.
      await io.revert()
      cold[scale] = { reference, updated }
    }
    for (const scale of new Set(sequence.filter((scale) => scale !== base))) {
      try {
        assertColdControl({
          platform,
          androidApi,
          base: cold[base].reference,
          target: cold[scale].reference,
          probes: screen.probes,
        })
        report.controls.push({ scale, pass: true })
      } catch (error) {
        report.controls.push({ scale, pass: false, ...failure(error) })
      }
    }

    await io.setScale(base)
    await io.launch()
    await io.navigate()
    let before = await io.fullText(await io.settle('before', base))
    let from = base
    // Every capture of this launch's earlier legs: heights a measurement cache could hand back.
    const earlier = []
    for (const to of sequence) {
      await io.setScale(to)
      const immediate = await io.capture('immediate', to)
      const settled = await io.fullText(await io.settle('settled', to))
      await io.update()
      const updated = await io.fullText(await io.settle('updated', to))
      const change = {
        platform,
        androidApi,
        before,
        immediate,
        settled,
        cold: cold[to].reference,
        coldBefore: cold[from].reference,
        coldBase: cold[base].reference,
        earlier: [...earlier],
        updated,
        coldUpdated: cold[to].updated,
        anchors: screen.anchors,
        probes: screen.probes,
        requiredControls: screen.controls,
        mount: screen.mount,
        bannerMarker: screen.bannerMarker,
      }
      const residualBaseline = residualBaselineFor(residualBaselines, {
        platform,
        build: label,
        screen: name,
        from,
        to,
        timezone,
        weatherBanner,
      })
      const leg = {
        from,
        to,
        ...judgeLeg({
          platform,
          androidApi,
          reactNativeVersion,
          residualBaseline,
          timezone,
          weatherBanner,
          change,
        }),
      }
      if (screen.composer) {
        leg.composer = composerGeometry(platform, androidDensity, [settled, updated])
        if (!leg.composer.pass) leg.pass = false
      }
      leg.evidence = { before, immediate, settled, updated }
      if (leg.residualProposal)
        leg.residualProposal = {
          platform,
          build: label,
          screen: name,
          from: String(from),
          to: String(to),
          timezone,
          weatherBanner,
          ...leg.residualProposal,
          review: {
            ...leg.residualProposal.review,
            controlPass:
              report.controls.length > 0 && report.controls.every((c) => c.pass),
          },
        }
      report.legs.push(leg)
      earlier.push(before, immediate, settled, updated)
      await io.revert()
      before = await io.fullText(await io.settle('before', to))
      from = to
    }
  } catch (error) {
    report.error = failure(error)
  }
  return report
}

/**
 * The run passes only when every requested screen finished, visited every scale in its
 * sequence on one launch, passed every growth control, and every leg passed (R4-03).
 */
export function aggregateVerdict(results, platform) {
  const reasons = []
  const expected = SCALES[platform].sequence
  for (const result of results) {
    if (result.error) reasons.push(`${result.screen}: ${result.error.error}`)
    const visited = (result.legs ?? []).map((leg) => leg.to)
    if (JSON.stringify(visited) !== JSON.stringify(expected))
      reasons.push(
        `${result.screen}: visited ${visited.join(',') || 'nothing'} of ${expected.join(',')}`
      )
    for (const control of result.controls ?? [])
      if (!control.pass)
        reasons.push(`${result.screen}: control ${control.scale} ${control.error}`)
    for (const leg of result.legs ?? [])
      if (!leg.pass)
        reasons.push(
          `${result.screen}: ${leg.from}->${leg.to} ${leg.error ?? leg.composer?.error ?? 'failed'}`
        )
  }
  if (!results.length) reasons.push('no screen ran')
  return { pass: reasons.length === 0, reasons }
}

/**
 * What the driver does for one requested screen, in order. Every run, a config-change run
 * included, first reads the React Native version the installed build reports, since every
 * hierarchy is checked against it and the report records it.
 */
export function screenRunSteps({ configChange, versionKnown }) {
  return [
    ...(versionKnown ? [] : ['read-version']),
    configChange ? 'config-change' : 'journey',
  ]
}

/**
 * The baselines file a reviewer would commit to approve every unapproved known-residual leg of
 * `results`: the current entries plus one proposal per leg, each with its evidence capture names
 * and, given `dir` (the proof dir relative to the repository), where those captures live, and,
 * given `weatherAging`, how the run aged the forecast. A proposal replaces the current entry with
 * the same identity (platform, build, screen, from, to, timezone, weather banner), so the file
 * keeps one entry per leg and environment; entries for another timezone or banner stay.
 * Null when no leg proposes one.
 */
export function proposedBaselines(current, results, { dir, weatherAging } = {}) {
  // A screen that errored before any leg has no legs and proposes nothing.
  const proposals = results.flatMap((result) =>
    (result.legs ?? [])
      .filter((leg) => leg.residualProposal)
      .map((leg) => ({
        ...leg.residualProposal,
        evidence: {
          ...(dir ? { dir } : {}),
          ...leg.evidence,
          ...(weatherAging ? { weatherAging } : {}),
        },
      }))
  )
  if (proposals.length === 0) return null
  const kept = current.entries.filter(
    (entry) => !proposals.some((proposal) => sameIdentity(entry, proposal))
  )
  return { ...current, entries: [...kept, ...proposals] }
}

/**
 * The proof dir `out` relative to the repository at `repoRoot`, for a baseline entry's evidence,
 * or undefined when `out` is the repository itself or lies outside it. Both sides are resolved
 * through symlinks, so a link inside the repository that points out of it counts as outside, and
 * only a whole `..` path segment leaves the repository (a dir named `..cache` stays in). `out`
 * must exist.
 */
export function proofDirInRepo(repoRoot, out) {
  const rel = path.relative(fs.realpathSync(repoRoot), fs.realpathSync(out))
  if (
    rel === '' ||
    rel === '..' ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  )
    return undefined
  return rel
}
