// Learning path Step 35: Premium theme switcher.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-35-premium-theme-switcher
// Story 5.3 Task 5 owner: the web settings "Interface palettes" section.
//
// These go through MSW rather than a mocked `lib/premium-theme`, so the request shape,
// the bearer header, the PUT body and the contract parsing are exercised by the same
// tests that cover the UI states. Nothing is mocked: `data-theme` on `<html>` is a real
// DOM write, which is exactly what AC 4 is about.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import axe from 'axe-core'
import { I18nextProvider } from 'react-i18next'
import { http, HttpResponse } from 'msw'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio, meetsWcagAA } from '@couture/utils'
import { getI18n } from '../../i18n'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from '../../lib/wardrobe'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import { PremiumThemeSection } from './premium-theme-section'

const THEME_PATH = '/api/v1/commerce/premium/theme'

type ThemeBody = Record<string, unknown>

function themeBody(overrides: ThemeBody = {}) {
  return { data: { theme: null, isEntitled: true, themesEnabled: true, ...overrides } }
}

function getHandler(overrides: ThemeBody = {}) {
  return http.get(THEME_PATH, () => HttpResponse.json(themeBody(overrides)))
}

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

function renderSection() {
  return render(
    <I18nextProvider i18n={getI18n()}>
      <PremiumThemeSection />
    </I18nextProvider>
  )
}

/** A promise the test resolves by hand, so a pending request needs no timer. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function card(dataTheme: string) {
  return screen.getByTestId(`premium-theme-option-${dataTheme}`)
}

function activeTheme() {
  return document.documentElement.getAttribute('data-theme')
}

/** `applyWebThemeAttribute(null)` writes an empty attribute for the Default palette. */
const DEFAULT_ACTIVE_THEME = ''

/**
 * Drains everything still queued behind a settled response.
 *
 * A save that was *not* cancelled reaches `applyWebThemeAttribute` several hops after
 * the handler returns: MSW has to hand the response back to `fetch`, and the component's
 * `await` has to resume. Asserting on `<html>` before those hops run would pass for the
 * wrong reason, so any test claiming an abandoned request never repainted the document
 * has to wait here first. Yielding a fixed number of event-loop turns rather than
 * sleeping a wall-clock interval keeps it stable on a loaded machine: every turn drains
 * the whole microtask queue, and the real path needs one.
 */
async function drainSettledResponses(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }
}

/*
 * Resolved through `fileURLToPath` on the string form rather than `new URL(...)`.
 * The jsdom environment replaces the global `URL`, and `node:fs` refuses an instance
 * of a class that is not its own, so the object form fails at runtime here.
 */
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'globals.css'),
  'utf8'
)

/**
 * The palette rules exactly as `globals.css` writes them, selector text included.
 *
 * The leading `:root,` on the Default block is load-bearing: `<html>` carries an empty
 * `data-theme` for Default, so `:root` is the rule that has to supply those values.
 * Comments are stripped first: the block comment above these rules contains no braces,
 * so it would otherwise be swept into the first selector.
 */
const PALETTE_RULES = [
  ...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
]
  .map(([, selector = '', body = '']) => ({ selector: selector.trim(), body }))
  .filter((rule) => rule.selector.includes('[data-theme='))

function paletteBlocks(): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>()
  for (const { selector, body } of PALETTE_RULES) {
    const name = /\[data-theme='([a-z_]+)'\]/.exec(selector)?.[1] ?? ''
    const declarations: Record<string, string> = {}
    for (const line of body.split(';')) {
      const [property, ...rest] = line.split(':')
      if (!property?.trim().startsWith('--')) continue
      declarations[property.trim()] = rest.join(':').trim()
    }
    blocks.set(name, declarations)
  }
  return blocks
}

const BLOCKS = paletteBlocks()

const PALETTE_PROPERTIES = [
  '--theme-primary',
  '--theme-secondary',
  '--theme-card-bg',
  '--theme-card-text',
  '--theme-card-border',
] as const

/**
 * Puts the real palette rules in the test document.
 *
 * The section only ever writes `data-theme`; the stylesheet is what turns that into
 * colors. With the rules installed, a test can assert the palette an element *resolves*.
 * An attribute nothing resolves from is precisely the regression this guards.
 */
function installPaletteStyles(): HTMLStyleElement {
  const style = document.createElement('style')
  style.textContent = PALETTE_RULES.map(
    ({ selector, body }) => `${selector} {${body}}`
  ).join('\n')
  document.head.append(style)
  return style
}

/**
 * The palette an element actually resolves, following custom-property inheritance.
 *
 * jsdom runs the cascade but does not inherit custom properties, so `getComputedStyle`
 * answers empty for `--theme-*` on any element that does not itself match one of the
 * installed `[data-theme]` rules. Walking up to the first ancestor that does resolve one
 * reproduces what a browser inherits, and it does so through jsdom's own selector
 * matching against the real `globals.css` rather than a second cascade written here. A
 * browser inherits, so it answers on the first iteration and the helper stays correct
 * wherever this file is run.
 */
function resolvedPalette(element: Element): Record<string, string> {
  const resolve = (property: string): string => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const value = getComputedStyle(node).getPropertyValue(property).trim()
      if (value) {
        return value
      }
    }
    return ''
  }

  return Object.fromEntries(
    PALETTE_PROPERTIES.map((property) => [property, resolve(property)])
  )
}

/** The one element in the section that inherits the applied palette (Decision 4). */
function previewPalette() {
  return resolvedPalette(screen.getByTestId('premium-theme-preview'))
}

/**
 * A jsdom axe pass over the rendered tree.
 *
 * This does not replace a browser run: jsdom has no layout, so axe cannot evaluate
 * `color-contrast` or target size here. On every unit run it does catch what this
 * section is most likely to introduce: an unlabelled control, a broken
 * `aria-describedby`, a list with a non-`li` child. Contrast is judged in the
 * stylesheet block below.
 */
async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  expect(
    results.violations,
    `Accessibility violations found:\n${JSON.stringify(results.violations, null, 2)}`
  ).toEqual([])
}

let paletteStyles: HTMLStyleElement

beforeEach(() => {
  window.sessionStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  paletteStyles = installPaletteStyles()
})

afterEach(() => {
  window.sessionStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  paletteStyles.remove()
})

describe('PremiumThemeSection', () => {
  it('5.3-WEB-100 renders signed out as the locked panel, with no request', async () => {
    const seen = vi.fn()
    useMswHandlers(
      http.get(THEME_PATH, () => {
        seen()
        return HttpResponse.json(themeBody())
      })
    )

    renderSection()

    const locked = await screen.findByTestId('premium-theme-locked')
    expect(locked).toHaveTextContent('Interface palettes are a Premium feature')
    /*
     * The names come from the `{{palettes}}` interpolation, built from
     * `PREMIUM_THEME_KEYS` and joined by `Intl.ListFormat`, so this asserts the
     * rendered join rather than just that one name survived. A palette added to
     * the contract appears here automatically; one that failed to interpolate
     * would render the raw placeholder and fail loudly.
     */
    expect(locked).toHaveTextContent('Jewel Radiance, Autumn Umber, and Winter Metallic')
    expect(locked).not.toHaveTextContent('{{palettes}}')
    expect(screen.queryByTestId('premium-theme-gallery')).not.toBeInTheDocument()
    expect(seen).not.toHaveBeenCalled()
    // AC 6: a signed-out reader gets Default whatever a previous session left behind.
    expect(activeTheme()).toBe('')
  })

  /**
   * Decision 11's deliberate divergence from `planner-rail.tsx`: this section already
   * sits on `/settings`, so the rail's link back to `/settings` would be a dead
   * control. The copy points at the subscribe controls above instead. No modal, no
   * countdown, no urgency: the PRD's "no dark patterns" guardrail.
   *
   * A signed-out reader gets different copy, because Decision 11's reasoning does not
   * reach them: `SubscriptionSection` renders only `commerce.premium.signedOutHint` when
   * there is no session, so "the controls above" would name a control that is not on the
   * page. Their copy names the sign-in step first. Both branches stay CTA-free.
   */
  it('5.3-WEB-101 offers no dead CTA and no urgency in the signed-out locked panel', async () => {
    renderSection()

    const locked = await screen.findByTestId('premium-theme-locked')
    expect(locked.querySelector('a')).toBeNull()
    expect(locked.querySelector('button')).toBeNull()
    expect(locked).toHaveTextContent('Sign in and subscribe to Premium')
    expect(locked).not.toHaveTextContent('controls above')
  })

  it('5.3-WEB-117 points a signed-in reader at the subscribe controls above instead', async () => {
    signIn()
    useMswHandlers(getHandler({ isEntitled: false, themesEnabled: true }))

    renderSection()

    const locked = await screen.findByTestId('premium-theme-locked')
    expect(locked.querySelector('a')).toBeNull()
    expect(locked.querySelector('button')).toBeNull()
    expect(locked).toHaveTextContent('controls above')
    expect(locked).not.toHaveTextContent('Sign in and subscribe')
  })

  it('5.3-WEB-102 shows the locked panel to a signed-in reader with no entitlement', async () => {
    signIn()
    useMswHandlers(getHandler({ isEntitled: false, themesEnabled: true }))

    renderSection()

    await screen.findByTestId('premium-theme-locked')
    expect(screen.queryByTestId('premium-theme-gallery')).not.toBeInTheDocument()
    expect(activeTheme()).toBe('')
  })

  /**
   * AC 1: exactly three named palettes plus Default. Asserted as the whole rendered
   * set rather than three positive lookups, so a fourth card cannot slip in unnoticed.
   */
  it('5.3-WEB-103 renders exactly three palettes plus Default for an entitled reader', async () => {
    signIn()
    useMswHandlers(getHandler({ theme: null }))

    renderSection()

    const gallery = await screen.findByTestId('premium-theme-gallery')
    const options = [...gallery.querySelectorAll('button')].map((button) =>
      button.getAttribute('data-theme')
    )
    expect(options).toEqual([
      'jewel_radiance',
      'autumn_umber',
      'winter_metallic',
      'default',
    ])

    expect(card('jewel_radiance')).toHaveTextContent('Jewel Radiance')
    expect(card('autumn_umber')).toHaveTextContent('Autumn Umber')
    expect(card('winter_metallic')).toHaveTextContent('Winter Metallic')
    expect(card('default')).toHaveTextContent('Default palette')
    expect(gallery).not.toHaveTextContent('Spring Bloom')
  })

  /** With nothing stored, Default is the pressed card: absent row and null are one state. */
  it('5.3-WEB-104 marks Default selected when nothing is stored', async () => {
    signIn()
    useMswHandlers(getHandler({ theme: null }))

    renderSection()

    await screen.findByTestId('premium-theme-gallery')
    expect(card('default')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('premium-theme-state-default')).toHaveTextContent(
      'Selected'
    )
    expect(card('jewel_radiance')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('premium-theme-state-jewel_radiance')).toHaveTextContent(
      'Apply'
    )
  })

  it('5.3-WEB-105 applies the stored palette to <html> on load', async () => {
    signIn()
    useMswHandlers(getHandler({ theme: 'autumn_umber' }))

    renderSection()

    await waitFor(() => expect(activeTheme()).toBe('autumn_umber'))
    expect(card('autumn_umber')).toHaveAttribute('aria-pressed', 'true')
  })

  /**
   * AC 4, the whole point of the story: the surface re-colors on save without a
   * reload. `data-theme` on `<html>` is the carrier, and `globals.css` does the rest.
   *
   * The attribute is asserted *and* the colors it produces are, because the attribute
   * alone proves nothing: every gallery card pins its own `data-theme`, so a build where
   * nothing inherits from `<html>` would still pass an attribute-only check while the
   * page stayed monochrome. The preview card is the element that inherits, so its
   * resolved palette is what makes "re-colors the surface" a claim about pixels.
   */
  it('5.3-WEB-010 re-colors the live preview and moves the selection on a successful save', async () => {
    signIn()
    const bodies: unknown[] = []
    useMswHandlers(
      getHandler({ theme: null }),
      http.put(THEME_PATH, async ({ request }) => {
        bodies.push(await request.clone().json())
        return HttpResponse.json(themeBody({ theme: 'jewel_radiance' }))
      })
    )

    renderSection()
    await screen.findByTestId('premium-theme-gallery')
    expect(activeTheme()).toBe('')
    const before = previewPalette()
    expect(before).toEqual(BLOCKS.get('default'))

    fireEvent.click(card('jewel_radiance'))

    await waitFor(() => expect(activeTheme()).toBe('jewel_radiance'))
    expect(previewPalette()).toEqual(BLOCKS.get('jewel_radiance'))
    expect(previewPalette()).not.toEqual(before)
    expect(bodies).toEqual([{ theme: 'jewel_radiance' }])
    expect(card('jewel_radiance')).toHaveAttribute('aria-pressed', 'true')
    expect(card('default')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /**
   * The structural reason `5.3-WEB-010` can hold: the preview pins no palette of its
   * own, so it inherits `<html>`'s, while every card pins one and cannot.
   *
   * Asserted separately because the two properties fail in opposite directions. Give the
   * preview a `data-theme` and it becomes a fifth swatch that never changes; drop the
   * cards' and they all render whichever palette is applied, which is not a gallery.
   */
  it('5.3-WEB-112 pins a palette on every card and none on the preview', async () => {
    signIn()
    useMswHandlers(getHandler({ theme: 'autumn_umber' }))

    renderSection()
    const gallery = await screen.findByTestId('premium-theme-gallery')

    for (const button of gallery.querySelectorAll('button')) {
      expect(button.getAttribute('data-theme')).toBeTruthy()
    }

    const preview = screen.getByTestId('premium-theme-preview')
    expect(preview.hasAttribute('data-theme')).toBe(false)
    expect(preview.querySelector('[data-theme]')).toBeNull()
    // Nothing between the preview and `<html>` pins one either, so the nearest palette
    // above it is always the applied one.
    expect(preview.closest('[data-theme]')).toBe(document.documentElement)
    // A card advertises its own palette; the preview wears the applied one.
    expect(resolvedPalette(card('jewel_radiance'))).toEqual(BLOCKS.get('jewel_radiance'))
    expect(previewPalette()).toEqual(BLOCKS.get('autumn_umber'))
  })

  it('5.3-WEB-113 returns the preview to Default when the palette is reset', async () => {
    signIn()
    useMswHandlers(
      getHandler({ theme: 'winter_metallic' }),
      http.put(THEME_PATH, () => HttpResponse.json(themeBody({ theme: null })))
    )

    renderSection()
    await waitFor(() => expect(activeTheme()).toBe('winter_metallic'))
    expect(previewPalette()).toEqual(BLOCKS.get('winter_metallic'))

    fireEvent.click(card('default'))

    await waitFor(() => expect(activeTheme()).toBe(''))
    expect(previewPalette()).toEqual(BLOCKS.get('default'))
  })

  /** Decision 8: reset is an upsert to null, expressed as an explicit PUT body. */
  it('5.3-WEB-106 resets to Default through the Default card', async () => {
    signIn()
    const bodies: unknown[] = []
    useMswHandlers(
      getHandler({ theme: 'winter_metallic' }),
      http.put(THEME_PATH, async ({ request }) => {
        bodies.push(await request.clone().json())
        return HttpResponse.json(themeBody({ theme: null }))
      })
    )

    renderSection()
    await waitFor(() => expect(activeTheme()).toBe('winter_metallic'))

    fireEvent.click(card('default'))

    await waitFor(() => expect(activeTheme()).toBe(''))
    expect(bodies).toEqual([{ theme: null }])
    expect(card('default')).toHaveAttribute('aria-pressed', 'true')
  })

  /**
   * AC 6: a palette key this build does not know renders Default cleanly. The gallery
   * still renders in full; a stale value must not cost the reader the whole section.
   */
  it('5.3-WEB-011 falls back to Default for an unknown stored palette', async () => {
    signIn()
    useMswHandlers(getHandler({ theme: 'spring_bloom' }))

    renderSection()

    await screen.findByTestId('premium-theme-gallery')
    expect(activeTheme()).toBe('')
    expect(card('default')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /**
   * AC 6: a failed read renders Default with a quiet inline error. It must not show the
   * locked panel either: a read that failed says nothing about entitlement, and
   * showing a subscriber an upsell for what they already pay for would be worse.
   *
   * AC 7: the copy is the catalog's, not the server's. The response below carries a
   * perfectly readable English `message` and it is deliberately NOT what renders: an
   * API error string has no translation, so surfacing it would show English to the nine
   * non-`en` catalogs on the one path they already have `loadError` for.
   */
  it('5.3-WEB-012 renders Default plus an inline error when the read fails', async () => {
    signIn()
    useMswHandlers(
      http.get(THEME_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 500,
            message: 'Unable to reach the palette service.',
            error: 'Internal Server Error',
          },
          { status: 500 }
        )
      )
    )

    renderSection()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Unable to load your interface palette. Showing the default palette.'
    )
    expect(alert).not.toHaveTextContent('Unable to reach the palette service.')
    expect(activeTheme()).toBe('')
    expect(screen.queryByTestId('premium-theme-gallery')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-theme-locked')).not.toBeInTheDocument()
    // Never a stuck loading state: the section stops claiming to be busy.
    expect(screen.getByTestId('premium-theme-section')).toHaveAttribute(
      'aria-busy',
      'false'
    )
  })

  /**
   * A 503 mid-session means the kill switch flipped under the reader, so the section
   * re-resolves into the state that already explains it, instead of printing a line and
   * leaving a live gallery behind.
   *
   * The earlier shape of this test asserted the server's own English message in an
   * alert and stopped there, which hid two defects: `themesEnabled` stayed `true`, so
   * every card stayed enabled and every further click failed identically with the
   * kill-switch note unreachable; and the message it asserted is untranslated, so nine
   * catalogs would have shown English (AC 7). Both are asserted against below.
   */
  it('5.3-WEB-107 keeps the applied palette and re-resolves to the kill-switch state when a save is refused', async () => {
    signIn()
    useMswHandlers(
      getHandler({ theme: 'autumn_umber' }),
      http.put(THEME_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: 'Premium themes are temporarily unavailable.',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      )
    )

    renderSection()
    await waitFor(() => expect(activeTheme()).toBe('autumn_umber'))

    fireEvent.click(card('jewel_radiance'))

    // The localized kill-switch note, which is also what a flag-off read renders.
    const note = await screen.findByTestId('premium-theme-unavailable')
    expect(note).toHaveTextContent(/switched off for now/)
    expect(screen.queryByText(/temporarily unavailable/)).not.toBeInTheDocument()

    // The gallery stops accepting writes instead of failing the same way forever.
    const gallery = screen.getByTestId('premium-theme-gallery')
    for (const button of gallery.querySelectorAll('button')) {
      expect(button).toBeDisabled()
    }

    // Not optimistic: a rejected write must never leave the page wearing a palette
    // that is not stored anywhere.
    expect(activeTheme()).toBe('autumn_umber')
    expect(card('autumn_umber')).toHaveAttribute('aria-pressed', 'true')
  })

  /**
   * The entitlement half of the same rule. A subscription that lapses while `/settings`
   * is open makes the next write a 403, and the section moves to the locked panel the
   * catalogs already translate. The failure mode it replaces is an English guard
   * message beside a gallery that still looks usable.
   */
  it('5.3-WEB-114 re-resolves to the locked panel when entitlement lapses under the reader', async () => {
    signIn()
    useMswHandlers(
      getHandler({ theme: 'autumn_umber' }),
      http.put(THEME_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'A Premium subscription is required for this feature.',
            error: 'Forbidden',
          },
          { status: 403 }
        )
      )
    )

    renderSection()
    await waitFor(() => expect(activeTheme()).toBe('autumn_umber'))

    fireEvent.click(card('jewel_radiance'))

    const locked = await screen.findByTestId('premium-theme-locked')
    expect(locked).toHaveTextContent('Interface palettes are a Premium feature')
    expect(screen.queryByText(/Premium subscription is required/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-theme-gallery')).not.toBeInTheDocument()
    // The lapsed subscriber's surface returns to Default, matching what the server
    // would resolve on the next read.
    expect(activeTheme()).toBe('')
  })

  /**
   * Re-pressing the card that already reads "Selected" is a no-op, not a second write.
   * The server answers 200 for an unchanged value by design and emits
   * `premium_theme_selected` unconditionally, so suppressing the duplicate here is what
   * keeps Decision 14's adoption count equal to the number of real choices.
   */
  it('5.3-WEB-115 sends no request when the already-selected card is pressed again', async () => {
    signIn()
    let puts = 0
    useMswHandlers(
      getHandler({ theme: 'autumn_umber' }),
      http.put(THEME_PATH, () => {
        puts += 1
        return HttpResponse.json(themeBody({ theme: 'autumn_umber' }))
      })
    )

    renderSection()
    await waitFor(() => expect(activeTheme()).toBe('autumn_umber'))
    expect(card('autumn_umber')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(card('autumn_umber'))
    fireEvent.click(card('autumn_umber'))
    await waitFor(() =>
      expect(card('autumn_umber')).toHaveAttribute('aria-busy', 'false')
    )

    expect(puts).toBe(0)
    expect(activeTheme()).toBe('autumn_umber')
  })

  /**
   * Signing out in another tab leaves this section mounted, `ready`, and interactive.
   * Without the re-check the write reaches the lib, which throws
   * PREMIUM_THEME_SIGNED_OUT_MESSAGE, a developer string with no catalog entry, so
   * English in all ten locales.
   */
  it('5.3-WEB-116 returns to the signed-out panel when the session ends mid-session', async () => {
    signIn()
    let puts = 0
    useMswHandlers(
      getHandler({ theme: 'autumn_umber' }),
      http.put(THEME_PATH, () => {
        puts += 1
        return HttpResponse.json(themeBody({ theme: 'jewel_radiance' }))
      })
    )

    renderSection()
    await waitFor(() => expect(activeTheme()).toBe('autumn_umber'))

    window.sessionStorage.clear()
    fireEvent.click(card('jewel_radiance'))

    const locked = await screen.findByTestId('premium-theme-locked')
    expect(locked).toBeInTheDocument()
    expect(puts).toBe(0)
    expect(
      screen.queryByText(/Sign in to choose an interface palette/)
    ).not.toBeInTheDocument()
    expect(activeTheme()).toBe('')
  })

  /**
   * Decision 9's kill switch. Only an entitled caller can ever observe it, and it
   * reaches this section as `themesEnabled: false` on the read. Every disabled card
   * points at the note that says why, the same pairing the commerce toggle uses for
   * its signed-out hint.
   */
  it('5.3-WEB-108 disables every card and explains why when the flag is off', async () => {
    signIn()
    useMswHandlers(getHandler({ theme: 'jewel_radiance', themesEnabled: false }))

    renderSection()

    const gallery = await screen.findByTestId('premium-theme-gallery')
    for (const button of gallery.querySelectorAll('button')) {
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(/switched off for now/)
    }
    const note = screen.getByTestId('premium-theme-unavailable')
    // Reading order: the reason precedes the controls it describes.
    expect(
      note.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // The stored palette is still applied and still readable; only writing is off.
    expect(activeTheme()).toBe('jewel_radiance')
    // Paired with `5.3-WEB-126`, which proves this exact opacity keeps a dimmed card
    // above the 4.5:1 floor. Changing one without the other breaks that pair.
    expect(card('jewel_radiance').className).toContain('disabled:opacity-70')
  })

  it('5.3-WEB-109 refuses a second write while the first is in flight', async () => {
    signIn()
    const gate = deferred<void>()
    let puts = 0
    useMswHandlers(
      getHandler({ theme: null }),
      http.put(THEME_PATH, async () => {
        puts += 1
        await gate.promise
        return HttpResponse.json(themeBody({ theme: 'jewel_radiance' }))
      })
    )

    renderSection()
    await screen.findByTestId('premium-theme-gallery')

    fireEvent.click(card('jewel_radiance'))
    await waitFor(() =>
      expect(card('jewel_radiance')).toHaveAttribute('aria-busy', 'true')
    )
    fireEvent.click(card('autumn_umber'))
    fireEvent.click(card('jewel_radiance'))

    gate.resolve()
    await waitFor(() => expect(activeTheme()).toBe('jewel_radiance'))
    expect(puts).toBe(1)
    // Busy, not disabled: taking a control out of the focus order mid-save moves focus
    // to `<body>` and loses a keyboard user's place, the lesson 5.1 already learned.
    expect(card('jewel_radiance')).toBeEnabled()
  })

  /**
   * Leaving the route mid-request must not land an error banner on a tree that is
   * already gone, and must not leave the fetch running.
   */
  it('5.3-WEB-110 abandons an in-flight read when the section unmounts', async () => {
    signIn()
    const gate = deferred<void>()
    const aborted = deferred<void>()
    useMswHandlers(
      http.get(THEME_PATH, async ({ request }) => {
        request.signal.addEventListener('abort', () => aborted.resolve())
        await gate.promise
        return HttpResponse.json(themeBody())
      })
    )

    const view = renderSection()
    await waitFor(() =>
      expect(screen.getByTestId('premium-theme-section')).toHaveAttribute(
        'aria-busy',
        'true'
      )
    )

    view.unmount()
    await aborted.promise
    gate.resolve()

    expect(screen.queryByTestId('premium-theme-section')).not.toBeInTheDocument()
  })

  /**
   * The write counterpart to `5.3-WEB-110`. `setThemeFromWeb` has always accepted a
   * signal and no caller passed one, so navigating away mid-save ran the request to
   * completion and then wrote `data-theme` onto the `<html>` of whatever page the reader
   * had moved to, from a component that no longer existed. The `<html>` assertion is
   * the load-bearing half: an aborted request that still repainted the document would
   * pass a state-only check.
   *
   * Two things about the ending are deliberate. The gate is released immediately after
   * unmount, before `aborted.promise` is awaited, and the attribute is then read once
   * through `drainSettledResponses` rather than polled. Awaiting the abort first and
   * polling for "not winter_metallic" afterwards looks stricter and is in fact vacuous:
   * the poll succeeds on its first tick, while `<html>` still holds the Default the load
   * left, long before the abandoned response could have overwritten it. Releasing the
   * gate first gives the un-cancelled path its full chance to repaint the document, so
   * the attribute check is the assertion that fails when the abort is removed. The
   * server-side `aborted.promise` stays as the second half of the proof: the request was
   * cancelled at the wire rather than discarded on arrival.
   */
  it('5.3-WEB-118 abandons an in-flight save when the section unmounts', async () => {
    signIn()
    const gate = deferred<void>()
    const aborted = deferred<void>()
    useMswHandlers(
      getHandler({ theme: null }),
      http.put(THEME_PATH, async ({ request }) => {
        request.signal.addEventListener('abort', () => aborted.resolve())
        await gate.promise
        return HttpResponse.json(themeBody({ theme: 'winter_metallic' }))
      })
    )

    const view = renderSection()
    await screen.findByTestId('premium-theme-gallery')
    fireEvent.click(card('winter_metallic'))
    await waitFor(() =>
      expect(card('winter_metallic')).toHaveAttribute('aria-busy', 'true')
    )

    view.unmount()
    gate.resolve()
    await drainSettledResponses()

    expect(screen.queryByTestId('premium-theme-section')).not.toBeInTheDocument()
    // `<html>` still carries the Default the load left: the palette the abandoned save
    // would have applied never reached the document, and never will.
    expect(activeTheme()).toBe(DEFAULT_ACTIVE_THEME)
    // And the cancellation reached the wire rather than being discarded on arrival.
    await aborted.promise
  })

  it('5.3-WEB-111 passes axe locked, in the gallery, and after a failed save', async () => {
    const locked = renderSection()
    await screen.findByTestId('premium-theme-locked')
    await expectNoAxeViolations(locked.container)
    locked.unmount()

    signIn()
    useMswHandlers(
      getHandler({ theme: 'winter_metallic' }),
      http.put(THEME_PATH, () =>
        HttpResponse.json({ statusCode: 500, message: 'Nope.' }, { status: 500 })
      )
    )
    const gallery = renderSection()
    await screen.findByTestId('premium-theme-gallery')
    await expectNoAxeViolations(gallery.container)

    fireEvent.click(card('jewel_radiance'))
    await screen.findByRole('alert')
    await expectNoAxeViolations(gallery.container)
  })
})

/**
 * AC 2, the web half: every pairing the gallery renders, proven against the WCAG 2.2 AA
 * maths in `@couture/utils` rather than eyeballed.
 *
 * `globals.css` is parsed rather than mirrored in a TypeScript table on purpose. A
 * second copy of the hex values inside this repository would be the thing that drifts;
 * the story already accepts one duplicate across web and mobile and no more.
 */
describe('5.3 premium palette tokens (globals.css)', () => {
  /**
   * Pinned to `refs/ux/ux-color-themes.html`, the file the UX spec designates as the
   * precise-values reference. Winter Metallic's card background is the flattened solid
   * Ice end of its two-stop gradient (Decision 2). The UX spec's prose separately names
   * Wine Red `#722F37` and Chestnut `#8C5331`; Decision 2 rules the HTML wins, so
   * neither appears here and neither should be "restored".
   */
  const EXPECTED = {
    default: {
      '--theme-primary': '#111111',
      '--theme-secondary': '#c9a14a',
      '--theme-card-bg': '#f5f5f7',
      '--theme-card-text': '#111111',
      '--theme-card-border': 'rgba(17, 17, 25, 0.2)',
    },
    jewel_radiance: {
      '--theme-primary': '#0d6f62',
      '--theme-secondary': '#6c3aa8',
      '--theme-card-bg': '#f4f6fb',
      '--theme-card-text': '#1f4e79',
      '--theme-card-border': 'rgba(31, 78, 121, 0.25)',
    },
    autumn_umber: {
      '--theme-primary': '#b1683a',
      '--theme-secondary': '#d9b38c',
      '--theme-card-bg': '#f3ede6',
      '--theme-card-text': '#3e2a23',
      '--theme-card-border': 'rgba(62, 42, 35, 0.2)',
    },
    winter_metallic: {
      '--theme-primary': '#7e889a',
      '--theme-secondary': '#c9cdd8',
      '--theme-card-bg': '#e9edf6',
      '--theme-card-text': '#2f333d',
      '--theme-card-border': 'rgba(47, 51, 61, 0.15)',
    },
  } as const

  it('5.3-WEB-120 declares exactly the four palettes the gallery renders', () => {
    expect([...BLOCKS.keys()].sort()).toEqual([
      'autumn_umber',
      'default',
      'jewel_radiance',
      'winter_metallic',
    ])
    expect(CSS).not.toContain('spring_bloom')
    expect(CSS).not.toContain('#722f37')
    expect(CSS).not.toContain('#8c5331')
  })

  it.each(Object.entries(EXPECTED))(
    '5.3-WEB-121 pins %s to the UX reference values',
    (name, expected) => {
      expect(BLOCKS.get(name)).toEqual(expected)
    }
  )

  /**
   * The card-preview pairing is the only one that carries text in the gallery, and it
   * clears the small-text floor in all four palettes (8.01-17.34:1). This is what makes
   * it safe to render every string in a card in `--theme-card-text`.
   */
  it.each(Object.keys(EXPECTED))(
    '5.3-WEB-122 clears the 4.5:1 small-text floor for %s body copy',
    (name) => {
      const block = BLOCKS.get(name)!
      const text = block['--theme-card-text']!
      const background = block['--theme-card-bg']!

      expect(meetsWcagAA(text, background)).toBe(true)
      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5)
    }
  )

  /**
   * The swatch dots are non-text UI, so SC 1.4.11's 3:1 floor applies. `--theme-primary`
   * clears it against its own card background unaided (3.05-17.34:1), but
   * `--theme-secondary` does not: Autumn Umber's Wheat measures 1.68:1 and Winter
   * Metallic's Platinum 1.36:1. That is why both dots are ringed in `--theme-card-text`,
   * and why this test checks the ring rather than the fill.
   */
  it.each(Object.keys(EXPECTED))(
    '5.3-WEB-123 keeps the %s swatch boundary discernible at 3:1',
    (name) => {
      const block = BLOCKS.get(name)!
      const ring = block['--theme-card-text']!
      const background = block['--theme-card-bg']!
      const primary = block['--theme-primary']!

      expect(meetsWcagAA(ring, background, { largeText: true })).toBe(true)
      expect(meetsWcagAA(primary, background, { largeText: true })).toBe(true)
    }
  )

  /**
   * The reason `--theme-primary` never carries text here. Two of the three fills miss
   * the small-text floor against white (Decision 2), so a future change that starts
   * writing on a primary fill has to confront this list rather than discover it.
   */
  it('5.3-WEB-124 records which primary fills may not carry small white text', () => {
    const failing = Object.keys(EXPECTED).filter(
      (name) => !meetsWcagAA('#ffffff', BLOCKS.get(name)!['--theme-primary']!)
    )

    expect(failing).toEqual(['autumn_umber', 'winter_metallic'])
  })

  /**
   * Borders are the one carrier that is not a plain hex, so they are excluded from the
   * ratio maths above (the helper rejects `rgba()` rather than guessing a backdrop).
   * They are decoration here: the selected state is text plus `aria-pressed`, never
   * a border color. Every palette still has to declare all five properties, or a
   * card would inherit a stray value from whatever palette is active on `<html>`.
   */
  it('5.3-WEB-125 declares all five carriers as single color values', () => {
    for (const [name, block] of BLOCKS) {
      expect(Object.keys(block).sort(), name).toEqual([
        '--theme-card-bg',
        '--theme-card-border',
        '--theme-card-text',
        '--theme-primary',
        '--theme-secondary',
      ])
      for (const [property, value] of Object.entries(block)) {
        expect(value, `${name} ${property}`).not.toContain('gradient')
      }
    }
  })

  /**
   * The kill-switch state dims every card with `disabled:opacity-70`, and CSS `opacity`
   * composites the whole card, text included, against the page behind it, which on
   * `/settings` is Tailwind's `bg-neutral-950` (#0a0a0a). That lowers the pairing this
   * block just proved: Jewel Radiance drops from 8.01:1 to 5.40:1.
   *
   * SC 1.4.3 exempts inactive controls, so nothing here is strictly required. It is
   * asserted anyway because a reader whose gallery has been switched off is exactly the
   * reader who needs to be able to read it, and because the number is one careless
   * `opacity-40` away from failing. Paired with `5.3-WEB-108`, which pins the class.
   */
  it('5.3-WEB-126 keeps a dimmed card readable at the disabled opacity', () => {
    const PAGE_BACKGROUND = [0x0a, 0x0a, 0x0a]
    const DISABLED_OPACITY = 0.7

    const composite = (hex: string) => {
      const channels = [1, 3, 5].map((index) =>
        Number.parseInt(hex.slice(index, index + 2), 16)
      )
      const blended = channels.map((channel, index) =>
        Math.round(
          DISABLED_OPACITY * channel + (1 - DISABLED_OPACITY) * PAGE_BACKGROUND[index]!
        )
      )
      return `#${blended.map((value) => value.toString(16).padStart(2, '0')).join('')}`
    }

    for (const name of Object.keys(EXPECTED)) {
      const block = BLOCKS.get(name)!
      const text = composite(block['--theme-card-text']!)
      const background = composite(block['--theme-card-bg']!)

      expect(meetsWcagAA(text, background), `${name} dimmed`).toBe(true)
    }
  })
})
