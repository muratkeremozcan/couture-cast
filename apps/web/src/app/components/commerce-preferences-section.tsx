// Story 5.1 Tasks 6 and 7 step 1 owner: implement Mobile and Web preference controls in `apps/mobile/app/(tabs)/settings.tsx` and `apps/web/src/app/components/commerce-preferences-section.tsx`
// Story 5.1 Task 7 owner: the "Shopping and partners" section of Web settings.
//
// This section is the Web half of the story's opt-out. There is deliberately no
// "Shop this look" CTA here: the only surface fed by real `/api/v1/ritual` data
// is the Mobile outfit card, and building a live Web ritual surface belongs to
// Epic 3.
//
// The section follows the session (`MemberScope`): while a stored session is still being
// verified it stays `checking`, and it reads once per member. A one-shot check on mount once told
// a signed-in member to sign in on every direct load of /settings (owner, 2026-11-19).
'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getCommercePreferenceFromWeb,
  isCommerceDenial,
  updateCommercePreferenceFromWeb,
} from '../../lib/commerce'
import {
  isLiveOwner,
  MemberScope,
  isSessionRecheckError,
  readAsMember,
  useSessionRecheck,
  type MemberSession,
} from '../../lib/use-web-session'
import { SessionRetryButton } from './session-retry-button'
import {
  GuestText,
  useGuestFirstPaint,
  useScreenGateRead,
  useSectionSnapshot,
} from './screen-gate'

const TOGGLE_ID = 'commerce-affiliate-ctas'
const HELP_ID = 'commerce-affiliate-ctas-help'
const SIGNED_OUT_HINT_ID = 'commerce-affiliate-ctas-signed-out'

/**
 * `checking` is the server render, the first client tick, and every moment a
 * stored session is still being verified. It renders the same disabled control
 * as `signed_out` without the hint, so hydration never has to reconcile two
 * different trees and a signed-in member never sees the hint.
 */
type SectionState = 'checking' | 'signed_out' | 'loading' | 'ready' | 'load_failed'

/**
 * Everything in the section belongs to the member the session bridge names right now: it is
 * keyed by that owner, so a change of member (or sign-out) discards the last member's
 * preference, save and messages in the same render.
 */
export function CommercePreferencesSection() {
  return (
    <MemberScope>
      {(session) => <MemberCommercePreferences session={session} />}
    </MemberScope>
  )
}

function MemberCommercePreferences({ session }: { session: MemberSession }) {
  const { t } = useTranslation()
  const { status, owner } = session
  /** A read denied while the bridge could not verify the member again: retryable. */
  const recheck = useSessionRecheck(owner)
  const {
    attempt: loadAttempt,
    markFailed: markRecheckFailed,
    clear: clearRecheck,
  } = recheck
  // Story CC-7.7 D5 (Codex review P1-2): a return to Profile shows this member's setting at once
  // and reads it again in place; a failed refresh keeps it.
  const snapshot = useSectionSnapshot<{ enabled: boolean }>('commerce', owner)
  const { beginRead, remember, restoredFor } = snapshot
  const [sectionState, setSectionState] = useState<SectionState>(snapshot.startState)
  const sectionStateRef = useRef(sectionState)
  sectionStateRef.current = sectionState
  const [enabled, setEnabled] = useState(() => snapshot.restored?.enabled ?? true)
  /**
   * The value the server last confirmed (a read or a save), kept apart from the optimistic
   * `enabled`: a return, or a refresh that fails, starts from what the server holds.
   */
  const [confirmed, setConfirmed] = useState(() => snapshot.restored?.enabled ?? true)
  /**
   * Advances when a save starts. A read started before it (a return's in-place refresh) answers
   * for an older value, so it never replaces the one the save commits.
   */
  const saveGenerationRef = useRef(0)
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

  /*
   * A separate string from the one above, and resolved the same way and for the
   * same reason. "Unable to update shopping preferences." is what the toggle
   * says when a save fails; telling someone their preferences could not be
   * *updated* when the page merely failed to *read* them points at the wrong
   * action, and the only action available after a failed read is a reload. A
   * failed session check is the exception: it offers Try again, which verifies
   * the session again.
   */
  const loadErrorMessage = t('commerce.settings.loadError')

  // One read per member: a session event that names the same member again (a token refresh,
  // the end of a verification already answered) asks nothing.
  useEffect(() => {
    // Every run decides afresh whether a failed recheck is still waiting.
    clearRecheck()
    if (status === 'checking') {
      setError(null)
      setSectionState('checking')
      return
    }
    if (status === 'unavailable') {
      // Verification failed: an outage the member can retry, never the sign-in hint.
      setError(loadErrorMessage)
      setSectionState('load_failed')
      return
    }
    if (owner === null) {
      setError(null)
      setSectionState('signed_out')
      return
    }
    // The bridge publishes again once it names this member; until then nothing is asked.
    if (!isLiveOwner(owner)) return

    const controller = new AbortController()
    const current = () => !controller.signal.aborted && isLiveOwner(owner)
    const inPlace = restoredFor === owner && sectionStateRef.current === 'ready'
    const saveGeneration = saveGenerationRef.current
    beginRead()
    setError(null)
    if (!inPlace) setSectionState('loading')

    void (async () => {
      try {
        // A denial of a token the bridge has since rotated for this member is read again once.
        const preference = await readAsMember(
          owner,
          () => getCommercePreferenceFromWeb(controller.signal),
          isCommerceDenial,
          controller.signal
        )
        if (!current()) {
          return
        }
        if (saveGeneration !== saveGenerationRef.current) {
          // A save started while this read was out: its answer is the newer value.
          setSectionState('ready')
          return
        }
        setEnabled(preference.affiliateCtasEnabled)
        setConfirmed(preference.affiliateCtasEnabled)
        setSectionState('ready')
      } catch (loadError: unknown) {
        if (!current()) {
          return
        }
        if (isSessionRecheckError(loadError)) {
          // The member is not known to be signed out: the load error with a retry, and a new
          // read once the bridge verifies them again.
          setError(loadErrorMessage)
          setSectionState('load_failed')
          markRecheckFailed(loadError)
          return
        }
        if (isCommerceDenial(loadError)) {
          // The API refused the bearer the bridge holds for this member, and no newer one
          // explains it: signed out, with the localized hint, like every sibling section.
          setSectionState('signed_out')
          return
        }
        // A restored setting stays on screen when its refresh fails, and a save started since
        // owns the control.
        if (inPlace || saveGeneration !== saveGenerationRef.current) return
        /*
         * The catalog string, unconditionally — the server's own message is
         * deliberately NOT shown.
         *
         * `commerceError` prefers the API's error body, which is English on
         * every locale, so routing it here put untranslated text in front of a
         * reader who had chosen one of nine other languages. `premium.ts` was
         * corrected the same way on 2026-08-19 for the same reason. These two
         * endpoints have no actionable failure to distinguish — a preferences
         * read either worked or did not — so there is nothing the server text
         * tells the reader that this string does not. The developer-facing
         * message survives on the thrown `CommerceRequestError` for logs.
         */
        setError(loadErrorMessage)
        setSectionState('load_failed')
      }
    })()

    return () => controller.abort()
  }, [
    status,
    owner,
    loadErrorMessage,
    loadAttempt,
    clearRecheck,
    markRecheckFailed,
    restoredFor,
    beginRead,
  ])

  // What a return to Profile shows first: the setting the server last confirmed, never a save
  // still in flight, and nothing after a failure.
  useEffect(() => {
    if (sectionState === 'ready') remember({ enabled: confirmed })
    else if (sectionState === 'load_failed' || sectionState === 'signed_out')
      remember(undefined)
  }, [confirmed, remember, sectionState])

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
    if (isSaving || !isLiveOwner(owner)) {
      return
    }

    const previous = enabled
    saveGenerationRef.current++
    setEnabled(nextEnabled)
    setIsSaving(true)
    setError(null)
    setConfirmation(null)

    try {
      const saved = await updateCommercePreferenceFromWeb({
        affiliateCtasEnabled: nextEnabled,
      })
      if (!isLiveOwner(owner)) return
      setEnabled(saved.affiliateCtasEnabled)
      setConfirmed(saved.affiliateCtasEnabled)
      setConfirmation(t('commerce.settings.saved'))
    } catch {
      if (!isLiveOwner(owner)) return
      setEnabled(previous)
      // Catalog copy, not the server's English. See the read path above.
      setError(genericErrorMessage)
    } finally {
      if (isLiveOwner(owner)) setIsSaving(false)
    }
  }

  const isSignedOut = sectionState === 'signed_out'
  // Story CC-7.7: Profile's screen gate waits for this read; a signed-out page paints the hint
  // from its first frame instead of inserting it when the session check ends.
  useScreenGateRead('commerce', sectionState !== 'checking' && sectionState !== 'loading')
  const guestFirstPaint = useGuestFirstPaint()
  const showGuestHint = sectionState === 'checking' && guestFirstPaint
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
      {showGuestHint && (
        <GuestText
          text={t('commerce.settings.signedOutHint')}
          className="mt-2 text-sm text-neutral-300"
        />
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

      <SessionRetryButton
        session={session}
        testId="commerce-session-retry"
        recheck={recheck.retry}
      />
    </section>
  )
}
