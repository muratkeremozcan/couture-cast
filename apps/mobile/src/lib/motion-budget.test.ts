// Learning path Step 65: Signed-in shell without flashes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-65-signed-in-shell-without-flashes
// Story CC-7.7 test owner (TEA): 7.7-UNIT-021, AC6 and spec D6.
// Test design: _bmad-output/test-artifacts/test-design-7-7-signed-in-shell-without-flashes.md.
// A static scan of the native app: every app-timed animation states a duration of 200 ms or
// less (Animated.timing defaults to 500 ms when none is given), every Modal takes its animation
// from the shared reduced-motion hook instead of a literal slide or fade, and the root stack
// transitions in 200 ms or less. The behavior under the OS setting is 7.7-NAT-005 (builder).
import { describe, expect, it } from 'vitest'
import { motionSources } from './motion-budget-sources.mjs'

const BUDGET_MS = 200
const sources = motionSources as Record<string, string>

/** The text of the first `{ ... }` argument after `start`, braces balanced. */
function configAfter(source: string, start: number): string | null {
  const open = source.indexOf('{', start)
  const close = source.indexOf(')', start)
  if (open === -1 || (close !== -1 && close < open)) return null
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(open, index + 1)
  }
  return null
}

/** Problems in one source: over-budget or missing durations, and literal modal animations. */
export function motionProblems(source: string): string[] {
  const problems: string[] = []
  for (const call of source.matchAll(/\b(Animated\.timing|withTiming)\s*\(/g)) {
    const config = configAfter(source, (call.index ?? 0) + call[0].length)
    // Comments are not configuration: a commented-out duration must not stand in for the real
    // one (CodeRabbit r1 #17).
    const code = config?.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const duration = code?.match(/\bduration\s*:\s*([^,}\n]+)/)?.[1]?.trim()
    if (duration === undefined) problems.push(`${call[1]} without a duration`)
    else if (!/^\d+$/.test(duration))
      problems.push(`${call[1]} duration ${duration} is not a literal`)
    else if (Number(duration) > BUDGET_MS)
      problems.push(`${call[1]} duration ${duration} ms`)
  }
  for (const match of source.matchAll(/\banimationDuration\s*:\s*(\d+)/g)) {
    if (Number(match[1]) > BUDGET_MS) problems.push(`animationDuration ${match[1]} ms`)
  }
  for (const match of source.matchAll(
    /\banimationType\s*=\s*(?:"(\w+)"|'(\w+)'|\{([^}]*)\})/g
  )) {
    // EdgeToEdgeModal applies the reduced-motion rule itself (the wrapper check below), so a
    // literal slide or fade on it is the motion-on presentation; on a bare Modal it is not.
    const tag = source.slice(0, match.index).match(/<([A-Za-z.]+)[^<]*$/)?.[1]
    if (tag === 'EdgeToEdgeModal') continue
    const literal = match[1] ?? match[2]
    if (literal !== undefined && literal !== 'none') {
      problems.push(`Modal animationType="${literal}" ignores reduced motion`)
    }
    if (match[3] !== undefined && /['"](slide|fade)['"]/.test(match[3])) {
      problems.push(`Modal animationType={${match[3].trim()}} bypasses the shared hook`)
    }
  }
  return problems
}

describe('7.7-UNIT-021 native motion budget', () => {
  it('reads real call shapes (the scan cannot pass blind)', () => {
    expect(
      motionProblems(
        'Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: false })'
      )
    ).toEqual([])
    expect(
      motionProblems(
        'Animated.timing(x, {\n  // duration: 150,\n  toValue: 1,\n  duration: 300,\n})'
      )
    ).toEqual(['Animated.timing duration 300 ms'])
    expect(
      motionProblems(
        'Animated.timing(x, { /* duration: 900 */ toValue: 1, duration: 150 })'
      )
    ).toEqual([])
    expect(motionProblems('Animated.timing(x, { toValue: 1, duration: 300 })')).toEqual([
      'Animated.timing duration 300 ms',
    ])
    expect(motionProblems('Animated.timing(x, { toValue: 1 })')).toEqual([
      'Animated.timing without a duration',
    ])
    expect(motionProblems('withTiming(1, { duration: ms })')).toEqual([
      'withTiming duration ms is not a literal',
    ])
    expect(motionProblems('<Modal animationType="slide" />')).toEqual([
      'Modal animationType="slide" ignores reduced motion',
    ])
    expect(
      motionProblems("<Modal animationType={reduceMotion ? 'none' : 'slide'} />")
    ).toEqual([
      "Modal animationType={reduceMotion ? 'none' : 'slide'} bypasses the shared hook",
    ])
    expect(motionProblems('<Modal animationType={modalAnimation} />')).toEqual([])
    expect(
      motionProblems('<EdgeToEdgeModal\n  visible={open}\n  animationType="slide"\n/>')
    ).toEqual([])
    expect(motionProblems('<Modal\n  visible\n  animationType="fade"\n/>')).toEqual([
      'Modal animationType="fade" ignores reduced motion',
    ])
    expect(motionProblems('screenOptions={{ animationDuration: 350 }}')).toEqual([
      'animationDuration 350 ms',
    ])
  })

  it('keeps every native animation at 200 ms or less and every Modal on the shared hook', () => {
    // The glob found the app: a broken pattern would pass on nothing.
    expect(Object.keys(sources)).toContain('../../app/_layout.tsx')
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    const problems = Object.entries(sources).flatMap(([path, source]) =>
      motionProblems(source).map((problem) => `${path.replace('../../', '')}: ${problem}`)
    )

    expect(problems).toEqual([])
  })

  it('EdgeToEdgeModal, the wrapper every app modal opens through, applies the reduced-motion rule', () => {
    const wrapper = sources['../../components/edge-to-edge-modal.tsx'] ?? ''

    expect(wrapper).toMatch(/useReducedMotion\(\)/)
    expect(wrapper).toMatch(/reducedMotion \? 'none' : props\.animationType/)
    expect(wrapper).toMatch(/animationType=\{animationType\}/)
  })

  it('gives the root stack a 200 ms transition (D6)', () => {
    const layout = sources['../../app/_layout.tsx'] ?? ''
    const duration = layout.match(/\banimationDuration\s*:\s*(\d+)/)?.[1]

    expect(duration, 'root stack animationDuration').toBeDefined()
    expect(Number(duration)).toBeLessThanOrEqual(BUDGET_MS)
  })
})
