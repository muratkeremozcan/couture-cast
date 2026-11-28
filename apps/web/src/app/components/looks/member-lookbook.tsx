'use client'

import { requestLookIdeas, ResponseError } from '@couture/api-client'
import type { SavedLookContract } from '@couture/api-client/contracts/http'
import {
  buildHomeSampleSavedLookInput,
  canShuffleMemberLookbook,
  createIdempotencyKey,
  createMemberLookbook,
  createMemberLookbookRanking,
  getGuestPreviewStrings,
  getMemberLookbookStrings,
  getStyleProfileStrings,
  isMemberLookbookDraftEdited,
  memberLookbookDraftKey,
  memberLookbookOutfitDraft,
  memberLookbookRankingCandidates,
  memberLookbookRankingInput,
  memberLookbookWeatherReason,
  presentMemberLookbookRanking,
  readMemberLookbookDraft,
  resolveMemberLookbookDraft,
  sampleGarmentText,
  sampleLookText,
  shuffleMemberLookbook,
  styleForecastSampleWeather,
  validateMemberLookbookRanking,
  type MemberLookbookDraft,
  type MemberLookbookRankingInput,
  type SampleGarmentCategory,
  type SampleOutfitResult,
  type SampleWeatherKey,
} from '@couture/utils'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { readStorage } from '../../../lib/browser-persistence'
import { createWebApiClient } from '../../../lib/api-client'
import { getRitualFromWeb } from '../../../lib/ritual'
import {
  createSavedLookFromWeb,
  deleteSavedLookFromWeb,
  formatSavedLookIfMatch,
  notifySavedLooksChanged,
  SavedLookRequestError,
} from '../../../lib/saved-looks'
import type { useWebStyleProfile } from '../../../lib/style-profile'
import {
  captureWebStyleBearer,
  currentWebStyleScope,
  readAsMember,
  UNVERIFIED_BEARER_OWNER,
  useMountSignal,
} from '../../../lib/use-web-session'
import { SampleGarmentArt } from '../guest-preview/sample-garment-art'
import { SaveActionButton } from '../save-feedback'
import { useSectionSnapshot } from '../screen-gate'
import { StyleDayControls } from '../style-profile-controls'
import { savedLookHref } from './looks-address'

function useLookbookWeather(owner: string, scope: string, locale: string) {
  const { restored, beginRead, remember } = useSectionSnapshot<SampleWeatherKey>(
    'lookbook-weather',
    owner
  )
  const [weather, setWeather] = useState(restored)
  useEffect(() => {
    let active: AbortController | undefined
    const read = () => {
      if (active || document.visibilityState === 'hidden') return
      const request = new AbortController()
      active = request
      beginRead()
      const current = () => !request.signal.aborted && currentWebStyleScope() === scope
      void readAsMember(
        owner,
        async () => {
          const token = captureWebStyleBearer(scope)
          if (!token || !current()) throw new Error('Lookbook session changed.')
          const ritual = await getRitualFromWeb(token, locale, request.signal)
          return styleForecastSampleWeather(ritual.weather.current)
        },
        (error) => error instanceof ResponseError && error.response.status === 401,
        request.signal
      )
        .then((next) => {
          if (!current()) return
          remember(next)
          setWeather(next)
        })
        .catch(() => {
          if (!current()) return
          remember(undefined)
          setWeather('mild-dry')
        })
        .finally(() => {
          active = undefined
        })
    }
    read()
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => {
      active?.abort()
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [beginRead, locale, owner, remember, scope])
  return weather
}

type SaveReceipt = Pick<SavedLookContract, 'id' | 'revision'>
type SaveAttempt = { idempotencyKey: string; receipt?: SaveReceipt }
type Mutation = 'save' | 'undo'

const MAX_SAVE_ATTEMPTS = 32
const control =
  'min-h-touch min-w-0 border px-2 py-2 text-sm font-semibold disabled:opacity-60 [overflow-wrap:anywhere]'
const neutral = 'border-line-strong bg-page text-ink'
const secondary = `${control} ${neutral} rounded-lg`

function useLookbookIdeas(
  owner: string,
  scope: string,
  weather: SampleWeatherKey | undefined,
  style: ReturnType<typeof useWebStyleProfile>,
  draft: MemberLookbookDraft | null,
  stillMember: () => boolean
) {
  const { day, profile, status } = style
  const [stylist] = useState(createMemberLookbookRanking)
  // Equivalent weather and profile reads share one request identity.
  const inputKey = JSON.stringify(
    memberLookbookRankingInput(weather ?? 'mild-dry', { profile, day })
  )
  const input = useMemo(
    () => JSON.parse(inputKey) as MemberLookbookRankingInput,
    [inputKey]
  )
  const ideas = useMemo(() => createMemberLookbook(input.weather, input), [input])
  const requestKey =
    weather && (status === 'ready' || status === 'failed') ? inputKey : null
  const ranking = useSyncExternalStore(stylist.subscribe, stylist.read, () => null)
  useLayoutEffect(() => {
    if (draft) stylist.markEdited()
  }, [draft, stylist])
  useLayoutEffect(() => {
    if (!requestKey) return
    return stylist.request(requestKey, stillMember, async (signal) => {
      const data = await readAsMember(
        owner,
        () => {
          const accessToken = captureWebStyleBearer(scope)
          if (!accessToken || signal.aborted || !stillMember())
            return Promise.resolve(null)
          return requestLookIdeas(createWebApiClient({ accessToken }), input, signal)
        },
        (error) => error instanceof ResponseError && error.response.status === 401,
        signal
      )
      return validateMemberLookbookRanking(
        data,
        memberLookbookRankingCandidates(ideas),
        input.weather
      )
    })
  }, [ideas, input, owner, requestKey, scope, stillMember, stylist])

  const currentRanking =
    ranking && ranking.key === requestKey && stillMember() ? ranking : null
  return {
    ...presentMemberLookbookRanking(ideas, draft?.mood, currentRanking),
    markEdited: stylist.markEdited,
    apply: () => stylist.apply(currentRanking, stillMember),
  }
}

export function MemberLookbook({
  owner,
  scope,
  style,
}: {
  owner: string
  scope: string
  style: ReturnType<typeof useWebStyleProfile>
}) {
  const { i18n } = useTranslation('translation', { useSuspense: false })
  const locale = i18n.language
  const strings = getGuestPreviewStrings(locale)
  const controls = getMemberLookbookStrings(locale)
  const styleCopy = getStyleProfileStrings(locale)
  const router = useRouter()
  const headingId = useId()
  const mountSignal = useMountSignal()
  const weather = useLookbookWeather(owner, scope, locale)
  const stillMember = useCallback(
    () => !mountSignal().aborted && currentWebStyleScope() === scope,
    [mountSignal, scope]
  )
  const storageKey =
    owner === UNVERIFIED_BEARER_OWNER ? null : memberLookbookDraftKey(owner)
  const [draft, setDraft] = useState(() =>
    storageKey ? readMemberLookbookDraft(readStorage('local', storageKey)) : null
  )
  const latestDraft = useRef(draft)
  const [mutation, setMutation] = useState<Mutation | null>(null)
  const pendingMutation = useRef<Mutation | null>(null)
  const attempts = useRef(new Map<string, SaveAttempt>())
  const {
    orderedIdeas,
    selected: idea,
    pending: newIdeas,
    description,
    markEdited,
    apply,
  } = useLookbookIdeas(owner, scope, weather, style, draft, stillMember)
  useEffect(() => {
    if (!storageKey) return
    const sync = ({ key }: StorageEvent) => {
      if ((key !== storageKey && key !== null) || currentWebStyleScope() !== scope) return
      const next = readMemberLookbookDraft(readStorage('local', storageKey))
      if (next) markEdited()
      latestDraft.current = next
      setDraft(next)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [scope, storageKey, markEdited])

  if (!idea) return null
  const { mood, result: base } = idea
  const { result, pinned } = resolveMemberLookbookDraft(base, draft?.looks[mood])
  const look = result.look
  const payload = buildHomeSampleSavedLookInput(result)
  const key = JSON.stringify(payload)
  const busy = mutation !== null
  const isEdited = isMemberLookbookDraftEdited(base, result, pinned)
  const isCurrent = (signal: AbortSignal) =>
    !signal.aborted && currentWebStyleScope() === scope

  function updateDraft(next: MemberLookbookDraft) {
    if (!isCurrent(mountSignal())) return
    markEdited()
    latestDraft.current = next
    setDraft(next)
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // The editor stays usable when device storage is blocked or full.
      }
    }
  }

  function updateOutfit(
    outfit: SampleOutfitResult,
    pins: readonly SampleGarmentCategory[],
    selectedMood = mood
  ) {
    const looks = { ...latestDraft.current?.looks }
    if (isMemberLookbookDraftEdited(base, outfit, pins)) {
      looks[mood] = memberLookbookOutfitDraft(outfit, pins)
    } else if (looks[mood]) {
      delete looks[mood]
    } else {
      return
    }
    updateDraft({ mood: selectedMood, looks })
  }

  function edit(outfit: SampleOutfitResult, pins: readonly SampleGarmentCategory[]) {
    if (!pendingMutation.current) {
      markEdited()
      updateOutfit(outfit, pins)
    }
  }

  function setMutationStatus(next: Mutation | null) {
    pendingMutation.current = next
    setMutation(next)
  }

  async function saveLook() {
    const signal = mountSignal()
    const token = captureWebStyleBearer(scope)
    if (pendingMutation.current || !payload || !token || !isCurrent(signal)) return false
    markEdited()
    const records = attempts.current
    const attempt = records.get(key) ?? {
      idempotencyKey: createIdempotencyKey(),
    }
    records.delete(key)
    records.set(key, attempt)
    if (records.size > MAX_SAVE_ATTEMPTS) {
      const oldest = records.keys().next()
      if (!oldest.done) records.delete(oldest.value)
    }
    const alreadySaved = Boolean(attempt.receipt)
    const startDraft = draft?.looks[mood]
    setMutationStatus('save')
    try {
      const record = await createSavedLookFromWeb(payload, {
        accessToken: token,
        idempotencyKey: attempt.idempotencyKey,
        signal,
      })
      if (!isCurrent(signal)) return false
      attempt.receipt = { id: record.id, revision: record.revision }
      const current = latestDraft.current
      // A live edit of this mood in another tab owns its newer pins.
      if (JSON.stringify(current?.looks[mood]) === JSON.stringify(startDraft)) {
        updateOutfit(result, [], current?.mood ?? mood)
      }
      notifySavedLooksChanged(owner)
      return { saved: true, undoable: !alreadySaved }
    } catch (error) {
      if (error instanceof SavedLookRequestError && error.status === 409) {
        records.delete(key)
      }
      throw error
    } finally {
      if (isCurrent(signal)) setMutationStatus(null)
    }
  }

  async function undoSave() {
    const receipt = attempts.current.get(key)?.receipt
    const token = captureWebStyleBearer(scope)
    const signal = mountSignal()
    if (pendingMutation.current || !receipt || !token || !isCurrent(signal)) return false
    setMutationStatus('undo')
    try {
      await deleteSavedLookFromWeb(
        receipt.id,
        formatSavedLookIfMatch(receipt.id, receipt.revision),
        {
          accessToken: token,
          signal,
        }
      )
    } catch (error) {
      if (!(error instanceof SavedLookRequestError && error.status === 404)) throw error
    } finally {
      if (isCurrent(signal)) setMutationStatus(null)
    }
    if (!isCurrent(signal)) return false
    attempts.current.delete(key)
    notifySavedLooksChanged(owner)
    return true
  }

  return (
    <section
      data-testid="member-lookbook"
      aria-labelledby={headingId}
      className="space-y-3"
    >
      <fieldset className="min-w-0 space-y-2" disabled={busy}>
        <legend className="sr-only">{styleCopy.mood}</legend>
        <div data-testid="lookbook-mood-row" className="grid grid-cols-3 gap-2">
          {orderedIdeas.map(({ mood: option }) => (
            <button
              key={option}
              type="button"
              data-testid={`lookbook-mood-${option}`}
              aria-pressed={option === mood}
              className={`${control} rounded-full ${option === mood ? 'border-primary bg-card text-ink ring-1 ring-primary' : neutral}`}
              onClick={() => {
                if (!pendingMutation.current)
                  updateDraft({ mood: option, looks: latestDraft.current?.looks ?? {} })
              }}
            >
              {styleCopy[option]}
            </button>
          ))}
        </div>
      </fieldset>
      <div
        data-testid="looks-idea-card-current"
        data-look-id={look?.id}
        data-surface="card"
        className="space-y-3 rounded-xl border border-line bg-card p-3 sm:p-4"
      >
        <div className="space-y-1 [overflow-wrap:anywhere]">
          <h2
            id={headingId}
            aria-live="polite"
            className="text-xl font-semibold text-ink"
          >
            {look ? sampleLookText(look, strings).name : strings.outfit.noEligible}
          </h2>
          <p data-testid="lookbook-weather-reason" className="text-sm text-ink-soft">
            {memberLookbookWeatherReason(result, locale)}
          </p>
          {description && (
            <p
              data-testid="lookbook-ai-description"
              className="text-sm text-ink-soft"
              lang="en"
            >
              {description}
            </p>
          )}
        </div>
        <ul className="grid grid-cols-2 gap-2 min-[361px]:grid-cols-3">
          {result.garments.map((piece) => {
            const { category } = piece
            const name = sampleGarmentText(piece, strings).name
            const selected = pinned.includes(category)
            return (
              <li
                key={category}
                data-testid={`lookbook-piece-${category}`}
                data-piece-id={piece.id}
                className="flex min-w-0 flex-col items-stretch rounded-lg border border-line bg-page p-2"
              >
                <SampleGarmentArt
                  garment={piece}
                  className="mx-auto h-14 w-full max-w-20"
                />
                <p className="mt-1 flex-1 text-center text-xs font-semibold text-ink [overflow-wrap:anywhere]">
                  {name}
                </p>
                <button
                  type="button"
                  data-testid={`lookbook-pin-${category}`}
                  aria-pressed={selected}
                  aria-label={`${controls.pin} ${name}`}
                  disabled={busy}
                  className={`mt-1 ${control} rounded-lg ${selected ? 'border-ink bg-inverse text-on-inverse' : neutral}`}
                  onClick={() =>
                    edit(
                      result,
                      selected
                        ? pinned.filter((pin) => pin !== category)
                        : [...pinned, category]
                    )
                  }
                >
                  {controls.pin}
                </button>
              </li>
            )
          })}
        </ul>
        {look && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="lookbook-shuffle"
              className={secondary}
              disabled={busy || !canShuffleMemberLookbook(result, pinned)}
              onClick={() => edit(shuffleMemberLookbook(result, pinned), pinned)}
            >
              {strings.firstRun.shuffle}
            </button>
            <button
              type="button"
              data-testid="lookbook-reset"
              className={secondary}
              disabled={busy || !isEdited}
              onClick={() => edit(base, [])}
            >
              {controls.reset}
            </button>
          </div>
        )}
        <fieldset disabled={busy} className="min-w-0">
          <StyleDayControls
            style={style}
            showMood={false}
            nested
            onInteract={markEdited}
          />
        </fieldset>
        {newIdeas && (
          <button
            type="button"
            className={secondary}
            data-testid="lookbook-new-ideas"
            disabled={busy}
            onClick={apply}
          >
            {controls.newIdeas}
          </button>
        )}
      </div>
      {payload && (
        <SaveActionButton
          data-testid="lookbook-save"
          data-primary-action="true"
          data-gold="primary"
          primary
          requiresNetwork
          disabled={mutation === 'undo'}
          ownerKey={scope}
          resetKey={key}
          idleLabel={strings.firstRun.save}
          onSave={saveLook}
          onUndo={undoSave}
          onView={() => {
            const receipt = attempts.current.get(key)?.receipt
            if (!pendingMutation.current && receipt && isCurrent(mountSignal()))
              router.push(savedLookHref(receipt.id))
          }}
        />
      )}
    </section>
  )
}
