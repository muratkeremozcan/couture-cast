// Story CC-7.9 D1 owner: web reads the one token set from `@couture/utils` here.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'
import {
  boxShadowFor,
  buildDesignTokenCssRules,
  COLOR_ROLE_NAMES,
  kebabTokenName,
  PREMIUM_PALETTE_FIELDS,
  radius,
  shell,
} from '@couture/utils'

/**
 * `colors` is replaced wholesale, not extended: the only colors are the D2 roles
 * (`bg-page`, `text-ink-muted`, `border-line-strong`) and the premium palette carriers
 * (`bg-theme-card-bg`, `text-theme-card-text`). Each is a channel triple, so opacity modifiers
 * keep working (`bg-scrim/50`). A Tailwind palette class such as `bg-amber-300` therefore
 * emits no CSS at all, which is why `scripts/check-design-tokens.mjs` fails on one.
 */
const channelColor = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`

const roleColors = Object.fromEntries(
  COLOR_ROLE_NAMES.map((role) => {
    const name = kebabTokenName(role)
    return [name, channelColor(`--cc-${name}`)]
  })
)

const paletteColors = Object.fromEntries(
  PREMIUM_PALETTE_FIELDS.map((field) => {
    const name = `theme-${kebabTokenName(field)}`
    return [name, channelColor(`--cc-${name}`)]
  })
)

export const designTokenColors = {
  transparent: 'transparent',
  current: 'currentColor',
  inherit: 'inherit',
  ...roleColors,
  ...paletteColors,
}

/** Emits every `--cc-*` variable: `:root`, the dark media query and each `[data-theme]`. */
export const designTokenPlugin = plugin((api) => {
  api.addBase(buildDesignTokenCssRules())
})

export default {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    colors: designTokenColors,
    borderRadius: {
      none: '0px',
      sm: `${radius.sm}px`,
      md: `${radius.md}px`,
      lg: `${radius.lg}px`,
      xl: `${radius.xl}px`,
      full: `${radius.full}px`,
    },
    boxShadow: {
      none: boxShadowFor('none'),
      card: boxShadowFor('card'),
      overlay: boxShadowFor('overlay'),
    },
    fontFamily: {
      sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
      mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
    },
    extend: {
      /**
       * The two shell clearances, the only spacing keys beyond D4's scale: `pb-safe` is the
       * device's bottom safe area and `pb-tab-bar` clears the fixed bottom tab bar (its 56 px,
       * 32 px of breathing room and the safe area). The guard allows exactly these two names.
       */
      spacing: {
        safe: 'env(safe-area-inset-bottom, 0px)',
        'tab-bar': `calc(${shell.tabBarHeight + 32}px + env(safe-area-inset-bottom, 0px))`,
      },
      borderColor: {
        DEFAULT: 'rgb(var(--cc-line))',
      },
    },
  },
  plugins: [designTokenPlugin],
} satisfies Config
