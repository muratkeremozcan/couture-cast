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
  type ColorScheme,
} from '@couture/utils'
import postcss, { type Root, type Rule } from 'postcss'
import tailwindcss from 'tailwindcss'
import { beforeAll, describe, expect, it } from 'vitest'
import config from '../tailwind.config'

const PROBE_CLASSES =
  'bg-page text-ink-muted bg-scrim/50 border-line-strong bg-amber-300 text-white'

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
