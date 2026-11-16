'use client'
// Story 6.17 D2: "Continue with Google", drawn to Google's sign-in branding guidelines.
import { useState } from 'react'
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
  theme?: 'light' | 'dark'
  /** Matches the page's other controls: pill on signup, rounded rectangle on sign-in. */
  shape?: 'pill' | 'rect'
  /** Lets a page show its own message for a start that failed. */
  onUnavailable?: (message: string) => void
}

export function GoogleSignInButton({
  from = null,
  door = 'signin',
  theme = 'light',
  shape = 'pill',
  onUnavailable,
}: GoogleSignInButtonProps) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const strings = getFederatedSignInStrings(i18n.language)
  const [opening, setOpening] = useState(false)
  const colours = GOOGLE_BUTTON_THEME[theme]
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
      className={`inline-flex min-h-12 w-full items-center justify-center gap-3 ${shape === 'pill' ? 'rounded-full' : 'rounded'} border px-5 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-progress disabled:opacity-80`}
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

/** The "or" rule between Google and the email form. */
export function SignInDivider({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const label = getFederatedSignInStrings(i18n.language).divider
  const line = tone === 'dark' ? 'bg-white/20' : 'bg-neutral-300'
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className={`h-px flex-1 ${line}`} />
      <span aria-hidden="true" className="text-sm opacity-80">
        {label}
      </span>
      <span className={`h-px flex-1 ${line}`} />
    </div>
  )
}
