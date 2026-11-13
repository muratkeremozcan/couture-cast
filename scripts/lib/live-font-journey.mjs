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
import { assertLiveProvenance, IOS_CONTENT_SIZES } from './live-font-capture.mjs'
import {
  assertColdControl,
  assertComposerControls,
  assertLiveFontProof,
  evaluateLiveFontChange,
} from './live-font-scale-proof.mjs'

const TABS = ['tab-home', 'tab-community', 'tab-settings']

/**
 * Screens, anchors, required controls and measured probes (size in sp, as styled). `volatile`
 * lists id prefixes the capture drops with their subtrees (see flattenHierarchy).
 */
export const SCREENS = {
  home: {
    flow: 'open-home',
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
    controls: TABS,
    probes: [{ id: 'community-new-post-label', sizeSp: 13 }],
  },
  settings: {
    flow: 'open-settings',
    anchors: ['settings-language-title'],
    controls: TABS,
    probes: [{ id: 'settings-language-title', sizeSp: 16 }],
  },
  composer: {
    flow: 'open-composer',
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

function judgeLeg({ platform, reactNativeVersion, residualBaseline, change }) {
  try {
    assertLiveProvenance({ ...change, platform })
    const result = assertLiveFontProof({
      reactNativeVersion,
      residualBaseline,
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
    return {
      pass: false,
      ...failure(error),
      verdict: evaluated.verdict ?? null,
      checks: evaluated.checks,
    }
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

/**
 * Runs one screen's journey. `io` supplies: `cold(scale)` (fresh launch at the scale, settled,
 * with full text), `launch()`, `setScale(scale)`, `navigate()`, `capture(stage, scale)`,
 * `settle(stage, scale)` and `fullText(capture)` for the live launch, and `update()`/`revert()`.
 */
export async function runScreenJourney({
  io,
  platform,
  androidApi,
  name,
  reactNativeVersion,
  residualBaselines = [],
  label,
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
        earlier: [...earlier],
        updated,
        coldUpdated: cold[to].updated,
        anchors: screen.anchors,
        probes: screen.probes,
        requiredControls: screen.controls,
      }
      const residualBaseline = residualBaselines.find(
        (entry) =>
          entry.platform === platform &&
          entry.build === label &&
          entry.screen === name &&
          String(entry.from) === String(from) &&
          String(entry.to) === String(to)
      )
      const leg = {
        from,
        to,
        ...judgeLeg({
          platform,
          androidApi,
          reactNativeVersion,
          residualBaseline,
          change,
        }),
      }
      if (screen.composer) {
        leg.composer = composerGeometry(platform, androidDensity, [settled, updated])
        if (!leg.composer.pass) leg.pass = false
      }
      leg.evidence = { before, immediate, settled, updated }
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
