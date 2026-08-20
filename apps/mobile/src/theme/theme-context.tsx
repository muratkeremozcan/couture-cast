// Story 5.3 Task 6 owner: the app-wide premium palette, and the single place that knows
// which one is applied.
//
// Follows `AccessibilityAnnouncerProvider`'s shape exactly (Decision 12): a Context, a
// Provider holding `useState`, and a consumer hook with a safe no-provider fallback. It
// is named `AppThemeProvider` rather than `ThemeProvider` on purpose —
// `app/_layout.tsx:2` already imports `ThemeProvider` from `@react-navigation/native`,
// and a same-named export would shadow or collide on import at the one file that has to
// mount both.
//
// Three things are load-bearing:
//
// - **This provider owns the fetch, and it is the only one.** It reads
//   `GET /api/v1/commerce/premium/theme` once on mount, which is what makes the applied
//   palette an app-wide fact rather than something that exists only while the settings
//   screen is open. The settings section consumes this state instead of issuing its own
//   read, so entering settings does not cost a second identical round trip, and there is
//   never a moment where the section and the rest of the app disagree about which
//   palette is applied.
// - **Nothing here blocks or throws.** A signed-out reader, a failed read, a timeout, or
//   a build with no API base URL all resolve to Default with a status the settings
//   section renders deliberately (AC 6). The palette is decoration on a settings screen;
//   it must never be able to stop the app from starting.
// - **This is a different axis from `constants/colors.ts`.** That is the OS light/dark
//   scheme, which the React Navigation `ThemeProvider` mounted below this one consumes.
//   A premium palette is the reader's own paid choice and rides on top of whichever OS
//   scheme is active.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import type { PremiumTheme, PremiumThemeKey } from '@couture/api-client/contracts/http'
import {
  getThemeFromMobile,
  premiumThemeFailureReason,
  type PremiumThemeFailureReason,
} from '@/src/lib/premium-theme'
import {
  DEFAULT_THEME_PALETTE,
  resolveThemePalette,
  type ThemePalette,
} from './theme-palettes'

/**
 * What the last read of the preference concluded.
 *
 * `signed-out` is split from `failed` because they are different facts with different
 * copy: a reader with no session is shown the locked panel's sign-in wording, while a
 * reader whose read genuinely failed is shown an error and Default. Collapsing them
 * would tell a signed-in subscriber their session had ended whenever the network
 * hiccupped.
 */
export type AppThemeStatus = 'loading' | 'ready' | 'signed-out' | 'failed'

export interface AppThemeValue {
  /** The palette the server last confirmed. `null` is the Default palette. */
  themeKey: PremiumThemeKey | null
  /** The five colors for {@link AppThemeValue.themeKey}, resolved. */
  palette: ThemePalette
  /** Server-resolved entitlement, from the same response as the palette. */
  isEntitled: boolean
  /** The `premium_themes_enabled` kill switch, as the server evaluated it. */
  themesEnabled: boolean
  status: AppThemeStatus
  /** Re-reads the preference. Never rejects; failures land in `status`. */
  refresh: () => Promise<void>
  /**
   * Adopts a freshly resolved server response — the instant-apply seam (AC 4).
   *
   * Applied on success only, never optimistically: re-coloring before the server agrees
   * would leave a rejected write (403, or 503 while the kill switch is off) showing a
   * palette that is not stored anywhere, which is a worse lie than a moment of latency
   * on a settings screen.
   */
  applyResolvedTheme: (theme: PremiumTheme) => void
  /**
   * Folds a rejected write back into this state so the surface re-resolves.
   *
   * Entitlement can lapse and the kill switch can flip while the app is open. Handling
   * those as error text alone leaves `isEntitled`/`themesEnabled` stale at `true`, so
   * the gallery stays fully enabled and every further press fails the same way — the
   * locked panel and the kill-switch note become unreachable, which is exactly the clean
   * fallback AC 6 requires. Returns the classified reason so the caller can decide
   * whether it also has a message to print.
   */
  applyFailure: (error: unknown) => PremiumThemeFailureReason
}

/**
 * The no-provider fallback: Default colors and a status that renders nothing.
 *
 * A consumer that only wants colors gets the palette every reader has before they
 * choose, which is the graceful answer for a component rendered outside the tree. It
 * stays in `loading` rather than `ready` so no caller can read a Default palette that
 * was never fetched as a confirmed "this reader has Default", and both mutators are
 * no-ops rather than throwing.
 */
const FALLBACK_VALUE: AppThemeValue = Object.freeze({
  themeKey: null,
  palette: DEFAULT_THEME_PALETTE,
  isEntitled: false,
  themesEnabled: false,
  status: 'loading' as const,
  refresh: () => Promise.resolve(),
  applyResolvedTheme: () => undefined,
  applyFailure: () => 'unknown' as const,
})

const AppThemeContext = createContext<AppThemeValue | null>(null)

export function AppThemeProvider({ children }: PropsWithChildren) {
  const [themeKey, setThemeKey] = useState<PremiumThemeKey | null>(null)
  const [isEntitled, setIsEntitled] = useState(false)
  const [themesEnabled, setThemesEnabled] = useState(false)
  const [status, setStatus] = useState<AppThemeStatus>('loading')

  /**
   * Aborts the in-flight read on unmount, and lets a second `refresh` supersede a first.
   * Without this, a read started at launch could still land after the reader signed out
   * and write a palette back over the Default the sign-out applied.
   */
  const controllerRef = useRef<AbortController | null>(null)

  const applyResolvedTheme = useCallback((theme: PremiumTheme) => {
    setThemeKey(theme.theme)
    setIsEntitled(theme.isEntitled)
    setThemesEnabled(theme.themesEnabled)
    setStatus('ready')
  }, [])

  const applyFailure = useCallback((error: unknown): PremiumThemeFailureReason => {
    const reason = premiumThemeFailureReason(error)
    switch (reason) {
      case 'signed_out':
        // Not a broken read. Whatever a previous session left applied goes back to
        // Default, and the section renders the sign-in wording rather than an error the
        // reader cannot act on.
        setThemeKey(null)
        setIsEntitled(false)
        setThemesEnabled(false)
        setStatus('signed-out')
        break
      case 'not_entitled':
        setThemeKey(null)
        setIsEntitled(false)
        setStatus('ready')
        break
      case 'themes_disabled':
        // The stored choice survives a kill switch; only the ability to change it stops.
        setThemesEnabled(false)
        setStatus('ready')
        break
      default:
        // A read that failed tells us nothing about entitlement, so the surface falls
        // back to Default and the section shows its error instead of an upsell a paying
        // subscriber would find insulting (AC 6).
        setThemeKey(null)
        setStatus('failed')
    }
    return reason
  }, [])

  const refresh = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const next = await getThemeFromMobile(controller.signal)
      if (!controller.signal.aborted) {
        applyResolvedTheme(next)
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        applyFailure(error)
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [applyResolvedTheme, applyFailure])

  useEffect(() => {
    void refresh()
    return () => controllerRef.current?.abort()
  }, [refresh])

  const value = useMemo<AppThemeValue>(
    () => ({
      themeKey,
      palette: resolveThemePalette(themeKey),
      isEntitled,
      themesEnabled,
      status,
      refresh,
      applyResolvedTheme,
      applyFailure,
    }),
    [
      themeKey,
      isEntitled,
      themesEnabled,
      status,
      refresh,
      applyResolvedTheme,
      applyFailure,
    ]
  )

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>
}

/**
 * The applied palette and the state behind it.
 *
 * Named `useAppTheme` to match `AppThemeProvider`, and to stay clear of React
 * Navigation's own `useTheme`, which answers the OS light/dark question instead.
 */
export function useAppTheme(): AppThemeValue {
  return useContext(AppThemeContext) ?? FALLBACK_VALUE
}
