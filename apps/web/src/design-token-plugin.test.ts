// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Story CC-7.9 test owner: 7.9-UNIT-006, the Tailwind plugin in `apps/web/tailwind.config.ts`
// emits every `--cc-*` variable from the shared tokens as channel triples, for `:root`, the dark
// media query and every premium `[data-theme]` in both schemes, and `colors` holds roles only.
// Test design: _bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md
import {
  COLOR_ROLE_NAMES,
  colorRoles,
  hexToChannels,
  kebabTokenName,
  PREMIUM_PALETTE_FIELDS,
  PREMIUM_PALETTE_KEYS,
  premiumPalettes,
  shell,
  space,
  typeScale,
  type ColorScheme,
} from '@couture/utils'
import postcss, { type Root, type Rule } from 'postcss'
import tailwindcss from 'tailwindcss'
import { beforeAll, describe, expect, it } from 'vitest'
import config, { designTokenFontSize, designTokenSpacing } from '../tailwind.config'

const PROBE_CLASSES = [
  'bg-page text-ink-muted bg-scrim/50 border-line-strong bg-amber-300 text-white',
  'text-sm text-3xl text-4xl p-4 p-7 gap-3 -mt-2 mt-auto h-top-bar h-tab-bar min-h-touch',
].join(' ')

let root: Root

beforeAll(async () => {
  const result = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: `<div class="${PROBE_CLASSES}"></div>` }],
    }),
  ]).process('@tailwind base;\n@tailwind utilities;', { from: undefined })
  root = result.root
})

/** The declarations of the rule with exactly `selector`, inside the dark media query or not. */
function declarations(selector: string, dark: boolean): Record<string, string> {
  const found: Record<string, string> = {}
  root.walkRules((rule: Rule) => {
    const inDark =
      rule.parent?.type === 'atrule' &&
      (rule.parent as { params?: string }).params === '(prefers-color-scheme: dark)'
    if (rule.selector !== selector || inDark !== dark) return
    rule.walkDecls((declaration) => {
      found[declaration.prop] = declaration.value
    })
  })
  return found
}

const SCHEMES: readonly ColorScheme[] = ['light', 'dark']

describe('7.9-UNIT-006 the token plugin emits the --cc-* variables', () => {
  it.each(SCHEMES)('emits every role on :root for %s as a channel triple', (scheme) => {
    const vars = declarations(':root', scheme === 'dark')
    for (const role of COLOR_ROLE_NAMES) {
      expect(vars[`--cc-${kebabTokenName(role)}`]).toBe(
        hexToChannels(colorRoles[scheme][role])
      )
    }
    expect(vars['color-scheme']).toBe(scheme)
  })

  const palettes = (['default', ...PREMIUM_PALETTE_KEYS] as const).flatMap((key) =>
    SCHEMES.map((scheme) => ({ key, scheme }))
  )
  it.each(palettes)("emits [data-theme='$key'] for $scheme", ({ key, scheme }) => {
    const vars = declarations(`[data-theme='${key}']`, scheme === 'dark')
    for (const field of PREMIUM_PALETTE_FIELDS) {
      expect(vars[`--cc-theme-${kebabTokenName(field)}`]).toBe(
        hexToChannels(premiumPalettes[key][scheme][field])
      )
    }
  })

  it('carries the Default palette on :root so an unthemed page has one', () => {
    expect(declarations(':root', false)['--cc-theme-card-bg']).toBe(
      hexToChannels(premiumPalettes.default.light.cardBg)
    )
    expect(declarations(':root', true)['--cc-theme-card-bg']).toBe(
      hexToChannels(premiumPalettes.default.dark.cardBg)
    )
  })

  it('builds role utilities over the variables, with opacity, and no palette class', () => {
    const css = root.toString()
    expect(css).toMatch(
      /\.bg-page\s*\{[^}]*rgb\(var\(--cc-page\) \/ var\(--tw-bg-opacity, 1\)\)/
    )
    expect(css).toMatch(/\.bg-scrim\\\/50\s*\{[^}]*rgb\(var\(--cc-scrim\) \/ 0\.5\)/)
    expect(css).toMatch(/\.border-line-strong\s*\{/)
    // `colors` is replaced wholesale: a Tailwind palette class emits nothing (the guard's reason).
    expect(css).not.toMatch(/\.bg-amber-300/)
    expect(css).not.toMatch(/\.text-white/)
  })
})

describe('7.9-UNIT-006 type, spacing and shell sizes come from the tokens', () => {
  const rem = (px: number) => `${px / 16}rem`
  const utility = (selector: string) => declarations(selector, false)

  it('maps every D4 type step to its font size and line height, and nothing larger', () => {
    for (const [key, { fontSize, lineHeight }] of Object.entries(typeScale)) {
      expect(designTokenFontSize[key as keyof typeof typeScale]).toEqual([
        rem(fontSize),
        { lineHeight: rem(lineHeight) },
      ])
    }
    expect(utility('.text-sm')).toEqual({
      'font-size': rem(typeScale.sm.fontSize),
      'line-height': rem(typeScale.sm.lineHeight),
    })
    expect(utility('.text-3xl')['font-size']).toBe(rem(typeScale['3xl'].fontSize))
    expect(utility('.text-4xl')).toEqual({})
  })

  it('maps every D4 spacing step and builds no off-scale padding', () => {
    for (const [key, px] of Object.entries(space)) {
      expect(designTokenSpacing[key as unknown as keyof typeof space]).toBe(
        px === 0 ? '0px' : rem(px)
      )
    }
    expect(utility('.p-4')).toEqual({ padding: rem(space[4]) })
    expect(utility('.gap-3')).toEqual({ gap: rem(space[3]) })
    expect(utility('.-mt-2')).toEqual({ 'margin-top': `-${rem(space[2])}` })
    expect(utility('.mt-auto')).toEqual({ 'margin-top': 'auto' })
    expect(utility('.p-7')).toEqual({})
  })

  it('sizes the top bar, the tab bar and the touch target from the shell tokens', () => {
    expect(utility('.h-top-bar')).toEqual({ height: `${shell.topBarHeight}px` })
    expect(utility('.h-tab-bar')).toEqual({ height: `${shell.tabBarHeight}px` })
    expect(utility('.min-h-touch')).toEqual({ 'min-height': `${shell.touchTarget}px` })
  })
})
