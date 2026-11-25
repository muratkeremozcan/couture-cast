// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 test owner (TEA): 7.7-UNIT-020, AC6 and spec D6.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md.
// A static scan: every transition and finite animation the web app defines lasts 200 ms or less,
// delay included, and the global reduced-motion rule makes them instant.
// Infinite animations (spinners) are loading indicators, not transitions, and are skipped.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const BUDGET_MS = 200

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'test-utils' ? [] : files(path)
    return /\.(css|ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)
      ? [path]
      : []
  })
}

const toMs = (amount: string | undefined, unit: string | undefined) =>
  Number(amount) * (unit === 's' ? 1000 : 1)

/** Every time a source gives a transition or a finite animation, in ms, with the text it came from. */
export function motionTimes(source: string): { ms: number; text: string }[] {
  const found: { ms: number; text: string }[] = []
  // Tailwind: duration-300, delay-500, duration-[350ms], delay-[0.4s].
  for (const match of source.matchAll(/\b(?:duration|delay)-(\d+)\b/g)) {
    found.push({ ms: Number(match[1]), text: match[0] })
  }
  for (const match of source.matchAll(/\b(?:duration|delay)-\[(\d*\.?\d+)(ms|s)\]/g)) {
    found.push({ ms: toMs(match[1], match[2]), text: match[0] })
  }
  // CSS declarations and inline style objects: transition, animation and their -duration and
  // -delay longhands (transitionDuration, animationDelay in style objects).
  const declarations =
    /\b(transition|animation)(?:-?(?:duration|delay|Duration|Delay))?['"]?\s*:\s*([^;{}\n]*)/g
  for (const match of source.matchAll(declarations)) {
    const value = match[2] ?? ''
    if (match[1] === 'animation' && /\binfinite\b/.test(value)) continue
    for (const time of value.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) {
      found.push({ ms: toMs(time[1], time[2]), text: match[0].trim() })
    }
  }
  return found
}

describe('7.7-UNIT-020 web motion budget', () => {
  it('reads the budget from real declarations (the scan cannot pass blind)', () => {
    expect(motionTimes('motion-safe:duration-300 transition-colors')).toEqual([
      { ms: 300, text: 'duration-300' },
    ])
    expect(motionTimes('.x { animation: planner-rail-in 280ms ease-out; }')).toEqual([
      { ms: 280, text: 'animation: planner-rail-in 280ms ease-out' },
    ])
    expect(motionTimes("style={{ transitionDuration: '0.4s' }}")[0]?.ms).toBe(400)
    expect(motionTimes('delay-[350ms]')).toEqual([{ ms: 350, text: 'delay-[350ms]' }])
    expect(motionTimes('.s { animation: spin 1s linear infinite; }')).toEqual([])
    expect(motionTimes('max-w-300 w-[300px] h-1.5s')).toEqual([])
  })

  it('keeps every web transition and finite animation at 200 ms or less', () => {
    const over = files(SRC).flatMap((path) =>
      motionTimes(readFileSync(path, 'utf8'))
        .filter(({ ms }) => ms > BUDGET_MS)
        .map(({ ms, text }) => `${relative(SRC, path)}: ${text} (${ms} ms)`)
    )

    expect(over).toEqual([])
  })

  it('makes every animation and transition instant under reduced motion', () => {
    const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8')
    const block = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*\*,\s*::before,\s*::after\s*{([^}]*)}/
    )?.[1]

    expect(block, 'global reduced-motion rule for every element').toBeDefined()
    for (const property of [
      'animation-duration',
      'animation-delay',
      'transition-duration',
      'transition-delay',
    ]) {
      const value = block?.match(
        new RegExp(`${property}:\\s*(\\d*\\.?\\d+)(ms|s)\\s*!important`)
      )
      expect(value, `${property} forced instant`).not.toBeNull()
      expect(toMs(value![1], value![2])).toBeLessThanOrEqual(0.01)
    }
  })
})
