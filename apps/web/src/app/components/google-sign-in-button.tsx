'use client'
// Story 6.17 D2: "Continue with Google", drawn to Google's sign-in branding guidelines.
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getFederatedSignInStrings,
  GOOGLE_BUTTON_THEME,
  GOOGLE_G_MARK_PATHS,
  GOOGLE_G_MARK_VIEWBOX,
  type SignInDoor,
} from '@couture/utils'
import { getI18n } from '../../i18n'
import { startWebGoogleSignIn } from '../../lib/web-session'

type GoogleSignInButtonProps = {
  /** Carried through the round trip; only `preview` survives it. */
  from?: string | null
  /** The page this button sits on; a failed round trip comes back to it. */
  door?: SignInDoor
  /**
   * Google's light or dark button. Story CC-7.9 D2: by default it follows the system scheme, like
   * the page it sits on, so a dark page never shows the light button.
   */
  theme?: 'light' | 'dark'
  /** Matches the page's other controls: pill on signup, rounded rectangle on sign-in. */
  shape?: 'pill' | 'rect'
  /** Lets a page show its own message for a start that failed. */
  onUnavailable?: (message: string) => void
}

export function GoogleSignInButton({
  from = null,
  door = 'signin',
  theme,
  shape = 'pill',
  onUnavailable,
}: GoogleSignInButtonProps) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  const [opening, setOpening] = useState(false)
  const systemScheme = useSystemScheme()
  // Google's own brand colors (its branding guidelines), kept in `@couture/utils`.
  const colours = GOOGLE_BUTTON_THEME[theme ?? systemScheme]
  return (
    <button
      type="button"
      data-testid="google-sign-in"
      disabled={opening}
      aria-busy={opening}
      onClick={() => {
        setOpening(true)
        void startWebGoogleSignIn({ from, door }).catch(() => {
          setOpening(false)
          onUnavailable?.(strings.unavailable)
        })
      }}
      style={{
        backgroundColor: colours.background,
        borderColor: colours.border,
        color: colours.text,
      }}
      className={`inline-flex min-h-12 w-full items-center justify-center gap-3 ${shape === 'pill' ? 'rounded-full' : 'rounded-md'} border px-5 py-3 text-sm font-medium disabled:cursor-progress disabled:opacity-80`}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={GOOGLE_G_MARK_VIEWBOX}
        width="20"
        height="20"
      >
        {GOOGLE_G_MARK_PATHS.map((path) => (
          <path key={path.fill} fill={path.fill} d={path.d} />
        ))}
      </svg>
      <span>{opening ? strings.opening : strings.continueWithGoogle}</span>
    </button>
  )
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Nothing to unsubscribe where the browser has no media queries (jsdom). */
function noop() {
  return undefined
}

function subscribeToScheme(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return noop
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** The system scheme; the server and the first hydration frame read light. */
function useSystemScheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    subscribeToScheme,
    () =>
      typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
        ? 'dark'
        : 'light',
    () => 'light'
  )
}

/** The "or" rule between Google and the email form. */
export function SignInDivider() {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const label = getFederatedSignInStrings(i18n.language).divider
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-line" />
      <span aria-hidden="true" className="text-sm text-ink-muted">
        {label}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
