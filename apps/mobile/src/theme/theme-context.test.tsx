// Story 5.3 Task 6: the app-wide premium palette provider.
//
// The settings section's suite covers the states a reader can see. This one covers the
// two things that live only here: the classification of every failure reason into a
// render state, and the no-provider fallback that keeps a stray consumer on Default
// instead of throwing. Both are AC 6 surface area: the section renders them, but this
// is where the decision is made.
// `render` from vitest-browser-react is typed as non-thenable but must be awaited for
// the effects it triggers to flush, exactly as the screen suites do.
/* eslint-disable @typescript-eslint/await-thenable */
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { server } from '../test-utils/msw/server'
import { setMobileAccessTokenResolver } from '../lib/mobile-auth'
import { AppThemeProvider, useAppTheme } from './theme-context'
import { DEFAULT_THEME_PALETTE, PREMIUM_THEME_PALETTES } from './theme-palettes'

const THEME_ROUTE = '*/api/v1/commerce/premium/theme'

const errorEnvelope = (statusCode: number, message: string) =>
  HttpResponse.json({ statusCode, message, error: 'Error' }, { status: statusCode })

/** Renders the whole context value as text, so every field is assertable. */
function ThemeProbe() {
  const { themeKey, palette, isEntitled, themesEnabled, status } = useAppTheme()

  return (
    <div
      data-testid="probe"
      data-status={status}
      data-theme-key={themeKey ?? 'null'}
      data-entitled={String(isEntitled)}
      data-themes-enabled={String(themesEnabled)}
      data-card-bg={palette.cardBg}
    />
  )
}

async function renderProbe() {
  await render(
    <AppThemeProvider>
      <ThemeProbe />
    </AppThemeProvider>
  )
  return screen.getByTestId('probe')
}

describe('AppThemeProvider', () => {
  let restoreAccessTokenResolver: (() => void) | undefined

  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL =
      typeof window !== 'undefined' ? window.location.origin : 'https://mock-api.test'
  })

  beforeEach(() => {
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => 'session-token')
  })

  afterEach(() => {
    restoreAccessTokenResolver?.()
    restoreAccessTokenResolver = undefined
  })

  it('applies the palette the server resolved, on mount, with no caller action', async () => {
    server.use(
      http.get(THEME_ROUTE, () =>
        HttpResponse.json({
          data: { theme: 'jewel_radiance', isEntitled: true, themesEnabled: true },
        })
      )
    )

    const probe = await renderProbe()

    await waitFor(() => {
      expect(probe.dataset.status).toBe('ready')
    })
    expect(probe.dataset.themeKey).toBe('jewel_radiance')
    expect(probe.dataset.cardBg).toBe(PREMIUM_THEME_PALETTES.jewel_radiance.cardBg)
    expect(probe.dataset.entitled).toBe('true')
  })

  /**
   * A reader with no session is a different fact from a read that failed, and the two get
   * different copy in the section: sign in first, versus "we could not load this". Reading
   * a 401 as an error would tell a signed-in subscriber their session had ended whenever
   * the network hiccupped, and reading a failure as signed-out would do the reverse.
   */
  it('reads a 401 as signed-out, on Default, rather than as a failure', async () => {
    server.use(http.get(THEME_ROUTE, () => errorEnvelope(401, 'Unauthorized')))

    const probe = await renderProbe()

    await waitFor(() => {
      expect(probe.dataset.status).toBe('signed-out')
    })
    expect(probe.dataset.themeKey).toBe('null')
    expect(probe.dataset.cardBg).toBe(DEFAULT_THEME_PALETTE.cardBg)
  })

  it('reads a 403 as a resolved, non-entitled reader on Default', async () => {
    server.use(http.get(THEME_ROUTE, () => errorEnvelope(403, 'Premium required.')))

    const probe = await renderProbe()

    // `ready`, not `failed`: the server answered, and its answer was "not entitled".
    // That is what lets the section render the locked upsell instead of an error.
    await waitFor(() => {
      expect(probe.dataset.status).toBe('ready')
    })
    expect(probe.dataset.entitled).toBe('false')
    expect(probe.dataset.themeKey).toBe('null')
  })

  /**
   * The kill switch stops the ability to change a palette, not the palette itself. A
   * stored choice survives it, which is what the section's "your saved choice is kept"
   * copy promises.
   */
  it('reads a 503 as themes disabled while staying resolved', async () => {
    server.use(http.get(THEME_ROUTE, () => errorEnvelope(503, 'Themes unavailable.')))

    const probe = await renderProbe()

    await waitFor(() => {
      expect(probe.dataset.status).toBe('ready')
    })
    expect(probe.dataset.themesEnabled).toBe('false')
  })

  /**
   * A read that failed tells us nothing about entitlement, so the honest state is Default
   * plus an error. An upsell there would insult a paying subscriber.
   */
  it('falls back to Default and reports failure for an unclassifiable error', async () => {
    server.use(http.get(THEME_ROUTE, () => errorEnvelope(500, 'Boom.')))

    const probe = await renderProbe()

    await waitFor(() => {
      expect(probe.dataset.status).toBe('failed')
    })
    expect(probe.dataset.themeKey).toBe('null')
    expect(probe.dataset.cardBg).toBe(DEFAULT_THEME_PALETTE.cardBg)
  })

  /**
   * A component rendered outside the tree gets the palette every reader has before they
   * choose, rather than a crash. It stays in `loading` so nothing can mistake an
   * un-fetched Default for a confirmed one, and the mutators are no-ops.
   */
  it('serves Default with no-op mutators when there is no provider', async () => {
    await render(<ThemeProbe />)
    const probe = screen.getByTestId('probe')

    expect(probe.dataset.status).toBe('loading')
    expect(probe.dataset.cardBg).toBe(DEFAULT_THEME_PALETTE.cardBg)
    expect(probe.dataset.entitled).toBe('false')
  })

  it('exposes no-op mutators and a resolving refresh outside a provider', async () => {
    function MutatorProbe() {
      const { refresh, applyResolvedTheme, applyFailure } = useAppTheme()
      return (
        <div
          data-testid="mutators"
          data-reason={applyFailure(new Error('anything'))}
          data-applied={String(
            applyResolvedTheme({ theme: null, isEntitled: true, themesEnabled: true }) ===
              undefined
          )}
          data-refresh={String(refresh() instanceof Promise)}
        />
      )
    }

    await render(<MutatorProbe />)
    const probe = screen.getByTestId('mutators')

    expect(probe.dataset.reason).toBe('unknown')
    expect(probe.dataset.applied).toBe('true')
    expect(probe.dataset.refresh).toBe('true')
  })
})
