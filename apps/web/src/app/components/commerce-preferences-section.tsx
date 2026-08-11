// Story 5.1 Task 7 owner: the "Shopping and partners" section of Web settings.
//
// This section is the Web half of the story's opt-out. There is deliberately no
// "Shop this look" CTA here: the only surface fed by real `/api/v1/ritual` data
// is the Mobile outfit card, and building a live Web ritual surface belongs to
// Epic 3.
'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  commerceErrorMessage,
  getCommercePreferenceFromWeb,
  hasWebSession,
  updateCommercePreferenceFromWeb,
} from '../../lib/commerce'

const TOGGLE_ID = 'commerce-affiliate-ctas'
const HELP_ID = 'commerce-affiliate-ctas-help'
const SIGNED_OUT_HINT_ID = 'commerce-affiliate-ctas-signed-out'

/**
 * `checking` is the server render and the first client tick, before
 * `sessionStorage` can be read. It renders the same disabled control as
 * `signed_out` without the hint, so hydration never has to reconcile two
 * different trees.
 */
type SectionState = 'checking' | 'signed_out' | 'loading' | 'ready' | 'load_failed'

export function CommercePreferencesSection() {
  const { t } = useTranslation()
  const [sectionState, setSectionState] = useState<SectionState>('checking')
  const [enabled, setEnabled] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  /*
   * Resolved outside the effect and depended on by value. Depending on `t`
   * itself would tie the effect to a function identity, and a library that
   * returned a fresh one per render would turn the read below into a request
   * loop.
   */
  const genericErrorMessage = t('commerce.settings.error')

  useEffect(() => {
    if (!hasWebSession()) {
      setSectionState('signed_out')
      return
    }

    const controller = new AbortController()
    setSectionState('loading')

    void (async () => {
      try {
        const preference = await getCommercePreferenceFromWeb(controller.signal)
        if (controller.signal.aborted) {
          return
        }
        setEnabled(preference.affiliateCtasEnabled)
        setSectionState('ready')
      } catch (loadError: unknown) {
        if (controller.signal.aborted) {
          return
        }
        setError(commerceErrorMessage(loadError, genericErrorMessage))
        setSectionState('load_failed')
      }
    })()

    return () => controller.abort()
  }, [genericErrorMessage])

  /**
   * Optimistic, and reverted on failure.
   *
   * The checkbox reflects the requested value immediately so the control never
   * feels dead, then takes the server's answer as authoritative. A failed save
   * puts the previous value back, because a consent control that keeps showing
   * a state the server rejected is a broken opt-out.
   */
  async function handleToggle(nextEnabled: boolean): Promise<void> {
    /*
     * Re-entrancy is refused here rather than by disabling the control.
     * Disabling it mid-save removes it from the focus order, and the browser
     * moves focus to `<body>`, so a keyboard user who toggles this loses their
     * place in the page entirely. The end-to-end keyboard journey caught that.
     * `aria-busy` announces the pending state without taking the control away.
     */
    if (isSaving) {
      return
    }

    const previous = enabled
    setEnabled(nextEnabled)
    setIsSaving(true)
    setError(null)
    setConfirmation(null)

    try {
      const saved = await updateCommercePreferenceFromWeb({
        affiliateCtasEnabled: nextEnabled,
      })
      setEnabled(saved.affiliateCtasEnabled)
      setConfirmation(t('commerce.settings.saved'))
    } catch (saveError: unknown) {
      setEnabled(previous)
      setError(commerceErrorMessage(saveError, genericErrorMessage))
    } finally {
      setIsSaving(false)
    }
  }

  const isSignedOut = sectionState === 'signed_out'
  /*
   * A read that failed leaves the control disabled on purpose. Falling back to
   * the default `true` would render an opted-out account as opted in, which
   * misstates a consent decision the server actually holds.
   */
  // Deliberately not `&& !isSaving`. A save in flight is a busy control, not a
  // disabled one; see the guard at the top of `handleToggle`.
  const isInteractive = sectionState === 'ready'
  const describedBy = [HELP_ID, isSignedOut ? SIGNED_OUT_HINT_ID : null]
    .filter(Boolean)
    .join(' ')

  return (
    <section
      aria-labelledby="commerce-preferences-title"
      data-testid="commerce-preferences-section"
      className="mt-10 max-w-2xl border-t border-neutral-800 pt-8"
    >
      <h2
        id="commerce-preferences-title"
        className="text-xl font-semibold text-white"
        data-testid="commerce-preferences-title"
      >
        {t('commerce.settings.sectionTitle')}
      </h2>

      {/*
        PRD NFR Security 4 requires explicit disclosure *and* a toggle. The
        disclosure is a sibling text node in reading order before the control,
        never a tooltip and never only an accessible name.
      */}
      <p
        className="mt-3 text-sm leading-relaxed text-neutral-200"
        data-testid="commerce-disclosure"
      >
        {t('commerce.settings.disclosure')}
      </p>

      <div className="mt-6 flex items-center gap-3">
        {/*
          No width or height utility here on purpose: `globals.css` gives every
          bare input a 44px minimum box, and a Tailwind size class would win on
          specificity and shrink the target below the story's floor.
        */}
        <input
          id={TOGGLE_ID}
          type="checkbox"
          checked={enabled}
          disabled={!isInteractive}
          aria-describedby={describedBy}
          aria-busy={isSaving}
          onChange={(event) => {
            void handleToggle(event.target.checked)
          }}
          className="shrink-0 accent-[#c9a14a] disabled:opacity-60"
          data-testid="commerce-opt-out-toggle"
        />
        <label
          htmlFor={TOGGLE_ID}
          className="text-base font-medium text-white"
          data-testid="commerce-opt-out-label"
        >
          {t('commerce.settings.optOutLabel')}
        </label>
      </div>

      <p id={HELP_ID} className="mt-2 text-sm text-neutral-300">
        {t('commerce.settings.optOutHelp')}
      </p>

      {isSignedOut && (
        <p
          id={SIGNED_OUT_HINT_ID}
          className="mt-2 text-sm text-neutral-300"
          data-testid="commerce-signed-out-hint"
        >
          {t('commerce.settings.signedOutHint')}
        </p>
      )}

      {/*
        Mounted unconditionally so assistive technology is already observing the
        region when the confirmation arrives; a live region added at the same
        moment as its text is routinely missed.
      */}
      <p
        role="status"
        className="mt-4 min-h-[1.25rem] text-sm text-emerald-300"
        data-testid="commerce-status-region"
      >
        {confirmation ?? ''}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-1 text-sm text-red-300"
          data-testid="commerce-error-message"
        >
          {error}
        </p>
      )}
    </section>
  )
}
