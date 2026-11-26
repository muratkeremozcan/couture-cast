#!/usr/bin/env node
/**
 * Story CC-7.9 (TEA, 7.9-NVIS-001..008): compares the eight native shell screens the visual shard
 * captured against the committed baselines, after the flow has captured all of them.
 *
 * The Maestro flow (`maestro/shell-visual-snapshots.yaml`) only captures: comparing inside the
 * flow stopped at the first missing or changed screen, so one run could never collect the other
 * seven (Codex P1-1). This step runs after the flow, reports every screen at once, writes a
 * `<name>-diff.png` beside each changed capture, and fails the job on any missing capture,
 * missing baseline, size change or pixel change above the budget.
 *
 * Usage: node scripts/visual-baselines/compare-native.mjs [--actual dir] [--baseline dir]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const NATIVE_SCREENS = ['light', 'dark'].flatMap((scheme) =>
  ['home', 'wardrobe', 'community', 'profile'].map((tab) => `${scheme}-${tab}`)
)
/** A channel moving by this much or less is antialiasing noise, not a change. */
export const CHANNEL_TOLERANCE = 16
/** Share of pixels allowed to differ beyond the tolerance (the flow's former 99% threshold). */
export const MAX_CHANGED_RATIO = 0.01

/**
 * Compares two RGBA buffers of equal size. Returns the changed share and a diff mask (changed
 * pixels red over a dimmed copy of the baseline).
 */
export function compareRaw(baseline, actual, { width, height }) {
  const diff = Buffer.alloc(width * height * 4)
  let changed = 0
  for (let offset = 0; offset < baseline.length; offset += 4) {
    const moved = [0, 1, 2, 3].some(
      (channel) =>
        Math.abs(baseline[offset + channel] - actual[offset + channel]) >
        CHANNEL_TOLERANCE
    )
    if (moved) {
      changed += 1
      diff.set([255, 0, 0, 255], offset)
    } else {
      const grey = Math.round(
        (baseline[offset] + baseline[offset + 1] + baseline[offset + 2]) / 3 / 3 + 170
      )
      diff.set([grey, grey, grey, 255], offset)
    }
  }
  return { ratio: changed / (width * height), diff }
}

const rgba = (file) =>
  sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

/** One screen's verdict: null when it matches, else the problem in words. */
export async function compareScreen(name, { actualDir, baselineDir }) {
  const actualFile = path.join(actualDir, `${name}.png`)
  const baselineFile = path.join(baselineDir, `${name}.png`)
  if (!fs.existsSync(actualFile))
    return `${name}: not captured (the flow stopped before it)`
  if (!fs.existsSync(baselineFile))
    return `${name}: no baseline at ${path.relative(root, baselineFile)} (review the capture, then npm run visual:pull-baselines)`
  const [baseline, actual] = await Promise.all([rgba(baselineFile), rgba(actualFile)])
  const { width, height } = baseline.info
  if (actual.info.width !== width || actual.info.height !== height)
    return `${name}: size ${actual.info.width}x${actual.info.height}, baseline ${width}x${height}`
  const { ratio, diff } = compareRaw(baseline.data, actual.data, { width, height })
  if (ratio <= MAX_CHANGED_RATIO) return null
  const diffFile = path.join(actualDir, `${name}-diff.png`)
  await sharp(diff, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(diffFile)
  return `${name}: ${(ratio * 100).toFixed(2)}% of pixels changed (budget ${MAX_CHANGED_RATIO * 100}%), diff ${path.relative(root, diffFile)}`
}

export async function compareAll(dirs) {
  const verdicts = await Promise.all(
    NATIVE_SCREENS.map((name) => compareScreen(name, dirs))
  )
  return verdicts.filter(Boolean)
}

const readArg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : path.resolve(process.argv[index + 1])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = await compareAll({
    actualDir: readArg('actual', path.join(root, 'maestro/artifacts/shell-visual')),
    baselineDir: readArg('baseline', path.join(root, 'maestro/snapshots/shell-visual')),
  })
  if (problems.length) {
    for (const problem of problems) console.error(`::error::native snapshot ${problem}`)
    console.error(
      `\n${problems.length} of ${NATIVE_SCREENS.length} native shell snapshots differ`
    )
    process.exit(1)
  }
  console.log(`All ${NATIVE_SCREENS.length} native shell snapshots match their baselines`)
}
