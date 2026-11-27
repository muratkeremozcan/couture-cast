'use client'
// Story 6.16 owner: the web guest preview at /preview. It resolves any stored session
// first (D1), gates on self-reported age (D2), then runs the sample policy over local
// guest state (D5, D7). Members are sent back to the app; nothing here calls a member API.
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  beginGuestLookSave,
  GUEST_PREVIEW_GARMENT_INTENT,
  GUEST_PREVIEW_SAVE_INTENT,
  GUEST_PREVIEW_VIEWS,
  getGuestPreviewStrings,
  nextSampleLook,
  SAMPLE_CATALOG,
  sampleGarmentText,
  sampleLookText,
  sampleSwapCandidates,
  sampleOutfitSwapOptions,
  selectSampleOutfit,
  toggleSampleVote,
  toSampleSelectionInput,
  formatPreviewString,
  type GuestPreviewSnapshot,
  type GuestPreviewState,
  type GuestPreviewStrings,
  type GuestPreviewView,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import { AppPage, APP_MAIN_CLASS } from '../app-page'
import { AppTopBar } from '../app-top-bar'
import {
  guestPreviewAnalytics,
  resolveWebPreviewSession,
  webGuestPreviewStore,
  type WebPreviewSession,
} from '../../../lib/guest-preview'
import { GuestPreviewControls, type GuestPreviewControl } from './guest-preview-controls'
import { GuestPreviewConversion } from './guest-preview-conversion'
import { GuestPreviewFeedback } from './guest-preview-feedback'
import { GuestPreviewGate } from './guest-preview-gate'
import { GuestPreviewOutfit } from './guest-preview-outfit'
import { GuestPreviewSaveSheet } from './guest-preview-save-sheet'
import { GuestPreviewSwapDialog } from './guest-preview-swap-dialog'
import { GuestPreviewWardrobe } from './guest-preview-wardrobe'
import { useGuestPreviewSnapshot } from './use-guest-preview'
import { StyleMoodRow } from '../style-profile-controls'
import { GuestStyleChoices } from './sample-idea-controls'
import { webGuestPreviewBirthdate } from '../../../lib/guest-preview-birthdate'

function parseView(value: string | null): GuestPreviewView {
  return GUEST_PREVIEW_VIEWS.find((view) => view === value) ?? 'outfit'
}

function useOnline() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/** D1: resolves any stored session before guest mode; a member is sent back to the app. */
function useWebPreviewSession(): [WebPreviewSession | 'checking', () => void] {
  const router = useRouter()
  const [session, setSession] = useState<WebPreviewSession | 'checking'>('checking')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setSession('checking')
    void resolveWebPreviewSession().then((resolved) => {
      if (!active) return
      setSession(resolved)
      if (resolved === 'member') {
        // Review F3: guest state left on this browser never reaches a member.
        webGuestPreviewBirthdate.clear()
        webGuestPreviewStore().clear()
        router.replace('/')
      }
    })
    const recheck = () => setAttempt((count) => count + 1)
    window.addEventListener('couture:session', recheck)
    return () => {
      active = false
      window.removeEventListener('couture:session', recheck)
    }
  }, [router, attempt])
  return [session, () => setAttempt((count) => count + 1)]
}

/** One policy result per state; the previous one lets a no-op change say it still suits. */
function useSampleResult(state: GuestPreviewState | null): SampleOutfitResult | null {
  const previous = useRef<SampleOutfitResult | undefined>(undefined)
  const result = useMemo(
    () =>
      state
        ? selectSampleOutfit(
            toSampleSelectionInput(state),
            SAMPLE_CATALOG,
            previous.current
          )
        : null,
    [state]
  )
  useEffect(() => {
    previous.current = result ?? undefined
  }, [result])
  return result
}

export function GuestPreview() {
  const router = useRouter()
  const params = useSearchParams()
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const locale = i18n.language
  const strings = getGuestPreviewStrings(locale)
  const store = webGuestPreviewStore()
  const online = useOnline()

  const [session, retrySession] = useWebPreviewSession()

  const snapshot = useGuestPreviewSnapshot(store, session === 'guest')
  const state = snapshot?.state ?? null
  const view = parseView(params.get('view'))

  const result = useSampleResult(state)

  const [noAlternative, setNoAlternative] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [swapCategory, setSwapCategory] = useState<SampleGarmentCategory | null>(null)
  const swapInvoker = useRef<HTMLElement | null>(null)
  const saveInvoker = useRef<HTMLButtonElement | null>(null)
  const [savePreviewStartedAt, setSavePreviewStartedAt] = useState<number | null>(null)
  const [previewExpired, setPreviewExpired] = useState(false)

  useEffect(() => {
    const clearOnExit = () => {
      if (window.location.pathname !== '/preview') webGuestPreviewBirthdate.clear()
    }
    window.addEventListener('popstate', clearOnExit)
    return () => {
      window.removeEventListener('popstate', clearOnExit)
      const path = window.location.pathname
      if (path !== '/signup' && path !== '/signin') clearOnExit()
    }
  }, [])

  const update = useCallback(
    (change: (current: GuestPreviewState) => GuestPreviewState) => {
      setNoAlternative(false)
      return store.update(change)
    },
    [store]
  )

  const navigate = (next: GuestPreviewView) => {
    update((current) => ({ ...current, view: next }))
    router.push(next === 'outfit' ? '/preview' : `/preview?view=${next}`, {
      scroll: false,
    })
    if (next === 'wardrobe') guestPreviewAnalytics.interacted('wardrobe_opened')
  }

  const status = previewStatusScreen({
    session,
    snapshot,
    strings,
    retrySession,
    previewExpired,
    onEligible: (birthdate) => {
      webGuestPreviewBirthdate.remember(store.start(), birthdate)
      setPreviewExpired(false)
      if (view !== 'outfit') router.replace('/preview')
      guestPreviewAnalytics.started()
    },
  })
  if (status || !state || !result) return status

  const input = toSampleSelectionInput(state)
  const lookId = result.look?.id
  const usableIds = new Set(
    result.garments.flatMap((garment) =>
      sampleSwapCandidates(SAMPLE_CATALOG, garment.category, input)
        .filter((candidate) => candidate.id !== garment.id)
        .map((candidate) => candidate.id)
    )
  )

  const applySwap = (category: SampleGarmentCategory, garmentId: string) => {
    if (!lookId || result.garments.some((garment) => garment.id === garmentId)) return
    update((current) => ({
      ...current,
      swaps: {
        ...current.swaps,
        [lookId]: { ...current.swaps[lookId], [category]: garmentId },
      },
    }))
    guestPreviewAnalytics.interacted('garment_swapped')
    const garment = SAMPLE_CATALOG.garments.find((item) => item.id === garmentId)
    if (garment) {
      setAnnouncement(
        formatPreviewString(strings.outfit.swapped, {
          garment: sampleGarmentText(garment, strings).name,
        })
      )
    }
  }

  const changeControl = (control: GuestPreviewControl | 'collection') => {
    guestPreviewAnalytics.interacted('control_changed', control)
  }

  const beginSave = (action: 'create_account' | 'sign_in') => {
    const next = update((current) => beginGuestLookSave(current, result))
    setSavePreviewStartedAt(null)
    if (!next) {
      webGuestPreviewBirthdate.clear()
      setPreviewExpired(true)
      return false
    }
    if (next.conversion?.intent !== GUEST_PREVIEW_SAVE_INTENT) return false
    guestPreviewAnalytics.signupClicked(action)
    return true
  }

  const beginGarment = (action: 'create_account' | 'sign_in') => {
    const next = update((current) => ({
      ...current,
      conversion: { intent: GUEST_PREVIEW_GARMENT_INTENT },
    }))
    if (!next) return false
    guestPreviewAnalytics.signupClicked(action)
    return true
  }

  return (
    <PreviewFrame
      strings={strings}
      showNav
      view={view}
      onNavigate={navigate}
      persistent={snapshot?.persistent ?? true}
      onReset={() => {
        setNoAlternative(false)
        store.reset()
        guestPreviewAnalytics.interacted('preview_reset')
        router.push('/preview', { scroll: false })
      }}
      onExit={() => {
        guestPreviewAnalytics.interacted('preview_exited')
        webGuestPreviewBirthdate.clear()
        store.clear()
        router.replace('/')
      }}
    >
      <p aria-live="polite" className="sr-only" data-testid="guest-preview-announcement">
        {announcement}
      </p>
      {view === 'wardrobe' ? (
        <GuestPreviewWardrobe
          strings={strings}
          collection={state.collection}
          usableIds={usableIds}
          onCollection={(collection) => {
            update((current) => ({ ...current, collection }))
            changeControl('collection')
          }}
          onUse={(garment) => applySwap(garment.category, garment.id)}
          onInspect={() => guestPreviewAnalytics.interacted('item_inspected')}
          onCategory={() =>
            guestPreviewAnalytics.interacted('control_changed', 'category')
          }
          onBackToOutfit={() => navigate('outfit')}
        />
      ) : (
        <div className="min-w-0 space-y-6">
          {view === 'outfit' ? (
            <>
              <GuestPreviewOutfit
                result={result}
                strings={strings}
                locale={locale}
                noAlternative={noAlternative}
                onTryAnother={() => {
                  const next = nextSampleLook(result)
                  if ('lookId' in next) {
                    update((current) => ({ ...current, selectedLookId: next.lookId }))
                    guestPreviewAnalytics.interacted('look_changed')
                    const nextLook = SAMPLE_CATALOG.looks.find(
                      (look) => look.id === next.lookId
                    )
                    if (nextLook) {
                      setAnnouncement(
                        formatPreviewString(strings.outfit.updated, {
                          look: sampleLookText(nextLook, strings).name,
                        })
                      )
                    }
                  } else {
                    setNoAlternative(true)
                  }
                }}
                onSwap={(category, invoker) => {
                  swapInvoker.current = invoker
                  setSwapCategory(category)
                }}
                onUndoSwaps={() => {
                  if (!lookId) return
                  update((current) => {
                    const { [lookId]: _removed, ...rest } = current.swaps
                    void _removed
                    return { ...current, swaps: rest }
                  })
                  guestPreviewAnalytics.interacted('swaps_undone')
                }}
                onBrowseWardrobe={() => navigate('wardrobe')}
                onReviewChoices={() => navigate('preferences')}
                onResetChoices={() => {
                  update((current) => ({ ...current, votes: {} }))
                  guestPreviewAnalytics.interacted('votes_reset')
                }}
                shuffleLabel={strings.firstRun.shuffle}
                saveAction={
                  <button
                    ref={saveInvoker}
                    type="button"
                    data-testid="sample-save-look"
                    aria-haspopup="dialog"
                    data-primary-action="true"
                    className="min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse"
                    onClick={() => setSavePreviewStartedAt(state.startedAt)}
                  >
                    {strings.firstRun.save}
                  </button>
                }
                mood={
                  <StyleMoodRow
                    selected={state.preferences?.style}
                    onSelect={(style) =>
                      update((current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          style: current.preferences?.style === style ? undefined : style,
                        },
                        selectedLookId: undefined,
                      }))
                    }
                  />
                }
              />
              <GuestStyleChoices
                labels={strings.styleIdeas}
                preferences={state.preferences}
                onPreferences={(preferences) =>
                  update((current) => ({
                    ...current,
                    preferences,
                    selectedLookId: undefined,
                  }))
                }
              />
            </>
          ) : (
            <>
              <GuestPreviewFeedback
                votes={state.votes}
                strings={strings}
                onVote={(id, vote) => {
                  update((current) => ({
                    ...current,
                    votes: toggleSampleVote(current.votes, id, vote),
                  }))
                  guestPreviewAnalytics.interacted('look_voted')
                }}
                onReset={() => {
                  update((current) => ({ ...current, votes: {} }))
                  guestPreviewAnalytics.interacted('votes_reset')
                }}
              />
              <GuestPreviewConversion
                strings={strings}
                offline={!online}
                onCreateAccount={() => beginGarment('create_account')}
                onSignIn={() => beginGarment('sign_in')}
              />
            </>
          )}
          <details>
            <summary
              data-testid="guest-preview-comfort-toggle"
              className="cursor-pointer py-2 text-sm font-semibold"
            >
              {strings.firstRun.optionalComfort}
            </summary>
            <GuestPreviewControls
              state={state}
              strings={strings}
              locale={locale}
              onWeather={(weather) => {
                update((current) => ({ ...current, weather }))
                changeControl('weather')
              }}
              onComfort={(comfort, control) => {
                update((current) => ({ ...current, comfort }))
                changeControl(control)
              }}
            />
          </details>
        </div>
      )}
      <GuestPreviewSaveSheet
        isOpen={savePreviewStartedAt === state.startedAt}
        strings={strings}
        invokerRef={saveInvoker}
        onClose={() => setSavePreviewStartedAt(null)}
        onChoose={beginSave}
      />
      <GuestPreviewSwapDialog
        category={swapCategory}
        {...sampleOutfitSwapOptions(result, swapCategory)}
        strings={strings}
        invokerRef={swapInvoker}
        onChoose={(garmentId) => {
          if (swapCategory) applySwap(swapCategory, garmentId)
          setSwapCategory(null)
        }}
        onClose={() => setSwapCategory(null)}
      />
    </PreviewFrame>
  )
}

/** Every screen before the preview itself: session check, retry, and the age gate. */
function previewStatusScreen({
  session,
  snapshot,
  strings,
  retrySession,
  previewExpired,
  onEligible,
}: {
  session: WebPreviewSession | 'checking'
  snapshot: GuestPreviewSnapshot | null
  strings: GuestPreviewStrings
  retrySession: () => void
  previewExpired: boolean
  onEligible: (birthdate: string) => void
}): React.ReactNode | null {
  if (
    session === 'checking' ||
    session === 'member' ||
    (session === 'guest' && !snapshot)
  ) {
    return (
      <PreviewFrame strings={strings} showNav={false}>
        <p
          role="status"
          data-testid="guest-preview-checking"
          className="text-sm text-ink-soft"
        >
          {strings.chrome.checkingSession}
        </p>
      </PreviewFrame>
    )
  }

  if (session === 'unavailable') {
    return (
      <PreviewFrame strings={strings} showNav={false}>
        <div className="space-y-3" data-testid="guest-preview-session-unavailable">
          <p role="alert" className="text-sm text-ink">
            {strings.chrome.sessionUnavailable}
          </p>
          <button
            type="button"
            onClick={retrySession}
            className="min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse"
          >
            {strings.chrome.retry}
          </button>
        </div>
      </PreviewFrame>
    )
  }

  if (!snapshot?.state) {
    return (
      <PreviewFrame strings={strings} showNav={false}>
        <GuestPreviewGate
          strings={strings}
          onEligible={onEligible}
          expired={previewExpired}
        />
      </PreviewFrame>
    )
  }

  return null
}

function PreviewFrame({
  strings,
  showNav,
  view,
  onNavigate,
  persistent = true,
  onReset,
  onExit,
  children,
}: {
  strings: ReturnType<typeof getGuestPreviewStrings>
  showNav: boolean
  view?: GuestPreviewView
  onNavigate?: (view: GuestPreviewView) => void
  persistent?: boolean
  onReset?: () => void
  onExit?: () => void
  children: React.ReactNode
}) {
  const navItems: { view: GuestPreviewView; label: string }[] = [
    { view: 'outfit', label: strings.chrome.navOutfit },
    { view: 'wardrobe', label: strings.chrome.navWardrobe },
    { view: 'preferences', label: strings.chrome.navPreferences },
  ]
  const outlineButton =
    'min-h-11 rounded-lg border border-line-strong bg-page px-3 text-sm font-medium text-ink'
  // Story CC-7.9 D6, D7: the shared top bar (back to Home) on the page surface. The preview's
  // own header row (reset, exit, the sample label and the section nav) is the body's first row,
  // since it does not fit the one-row top bar.
  return (
    <AppPage>
      <AppTopBar title={strings.chrome.entry} parentHref="/" wrapTitle />
      <main id="main-content" tabIndex={-1} className={`${APP_MAIN_CLASS} gap-6`}>
        <div className="flex flex-col gap-3">
          <p
            role="note"
            data-testid="guest-preview-label"
            className="text-sm text-ink-muted"
          >
            {strings.firstRun.sampleLabel}
          </p>
          {!persistent ? (
            <p
              role="status"
              data-testid="guest-preview-storage"
              className="text-sm text-notice-ink"
            >
              {strings.chrome.storageUnavailable}
            </p>
          ) : null}
          {showNav ? (
            <nav aria-label={strings.chrome.navLabel} data-testid="guest-preview-nav">
              <ul className="flex flex-wrap gap-2">
                {navItems.map((item) => (
                  <li key={item.view} className="min-w-0 max-w-full">
                    <a
                      href={
                        item.view === 'outfit' ? '/preview' : `/preview?view=${item.view}`
                      }
                      aria-current={item.view === view ? 'page' : undefined}
                      data-testid={`guest-preview-nav-${item.view}`}
                      onClick={(event) => {
                        event.preventDefault()
                        onNavigate?.(item.view)
                      }}
                      className={`inline-flex min-h-11 max-w-full items-center rounded-full px-2 text-sm font-semibold min-[361px]:px-4 ${
                        item.view === view
                          ? 'bg-inverse text-on-inverse'
                          : 'border border-line-strong bg-page text-ink'
                      }`}
                    >
                      <span className="min-w-0 hyphens-auto [overflow-wrap:anywhere]">
                        {item.label}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
        {children}
        {showNav ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onReset}
              data-testid="guest-preview-reset"
              className={outlineButton}
            >
              {strings.chrome.resetPreview}
            </button>
            <button
              type="button"
              onClick={onExit}
              data-testid="guest-preview-exit"
              className={outlineButton}
            >
              {strings.chrome.exitPreview}
            </button>
          </div>
        ) : null}
      </main>
    </AppPage>
  )
}
