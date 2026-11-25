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

/** Splits a CSS value at commas that are not inside parentheses. */
function splitTopLevel(value: string): string[] {
  const items: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      items.push(value.slice(start, index))
      start = index + 1
    }
  }
  items.push(value.slice(start))
  return items
}

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
    /\b((?:transition|animation)(?:-?(?:duration|delay|Duration|Delay))?)['"]?\s*:\s*([^;{}\n]*)/g
  for (const match of source.matchAll(declarations)) {
    const property = match[1] ?? ''
    const shorthand = property === 'transition' || property === 'animation'
    // Each comma-separated item is its own transition or animation (CodeRabbit r1 #19); commas
    // inside cubic-bezier(...) and steps(...) belong to the timing function.
    for (const item of splitTopLevel(match[2] ?? '')) {
      const times = [...item.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].map((time) =>
        toMs(time[1], time[2])
      )
      if (times.length === 0) continue
      if (property === 'animation' && /\binfinite\b/.test(item)) continue
      if (shorthand) {
        // The first time is the duration, the second the delay: together they are how long the
        // item takes to finish (CodeRabbit r1 #18).
        found.push({
          ms: (times[0] ?? 0) + (times[1] ?? 0),
          text: `${property}: ${item.trim()}`,
        })
      } else {
        for (const ms of times) found.push({ ms, text: `${property}: ${item.trim()}` })
      }
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
    // Duration and delay of one transition add up (CodeRabbit r1 #18).
    expect(motionTimes('.t { transition: opacity 150ms ease 150ms; }')).toEqual([
      { ms: 300, text: 'transition: opacity 150ms ease 150ms' },
    ])
    // Parallel transitions stay apart; a comma inside cubic-bezier() does not split one.
    expect(
      motionTimes(
        '.t { transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1), color 100ms; }'
      )
    ).toEqual([
      { ms: 150, text: 'transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1)' },
      { ms: 100, text: 'transition: color 100ms' },
    ])
    // A spinner beside a finite animation skips the spinner only (CodeRabbit r1 #19).
    expect(
      motionTimes('.a { animation: spin 1s linear infinite, rise 300ms ease-out; }')
    ).toEqual([{ ms: 300, text: 'animation: rise 300ms ease-out' }])
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
