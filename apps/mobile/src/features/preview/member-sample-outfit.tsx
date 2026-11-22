import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { SavedLookContract } from '@couture/api-client/contracts/http'
import {
  buildHomeSampleSavedLookInput,
  createAnnouncementToken,
  createIdempotencyKey,
  createMemberSampleOutfit,
  getGuestPreviewStrings,
  isOfflineError,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  reopenMemberSampleOutfit,
  rotateMemberSampleOutfit,
  sampleSwapCandidates,
  SAMPLE_CATALOG,
  savedLookMatchesHomeSample,
  savedLookToSampleBookmark,
  swapMemberSampleGarment,
  undoMemberSampleSwaps,
  updateMemberSampleOutfit,
  type SampleBookmark,
  type SampleGarmentCategory,
  type SampleOutfitResult,
} from '@couture/utils'
import { useHeroPalette } from '@/components/hero/hero-theme'
import {
  checkNetworkOnlineForAction,
  getNetworkOnline,
  hasReliableBrowserOnline,
  reportNetworkOffline,
  setMobilePrimaryActionClearance,
  useStatusBar,
} from '@/components/save-feedback'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  resolveMobileAccessToken,
} from '@/src/lib/mobile-auth'
import {
  createSavedLookFromMobile,
  deleteSavedLookFromMobile,
  formatSavedLookIfMatch,
  getSavedLookFromMobile,
  listSavedLooksFromMobile,
  MobileSavedLookRequestError,
  notifyMobileSavedLooksChanged,
  restoreSavedLookFromMobile,
  subscribeMobileSavedLooksChanged,
} from '@/src/lib/saved-looks'
import { PreviewButton, PreviewOutfit, PreviewSwapSheet } from './guest-preview-parts'
import { SampleIdeaControls } from './sample-idea-controls'

function buildMobileSampleAttemptKey(
  owner: string,
  lookId: string,
  garmentsSignature: string,
  weather: string,
  payload: NonNullable<ReturnType<typeof buildHomeSampleSavedLookInput>>
): string {
  const comfort = payload.comfort!
  const comfortSig = `${comfort.runsColdWarm}/${comfort.windTolerance}/${comfort.precipPreparedness}`
  return `${owner}:${lookId}:${garmentsSignature}:${weather}:${payload.collection!}:${comfortSig}:${JSON.stringify(payload.swaps)}`
}

function mergeMobileInitialSavedLooks(
  current: SavedLookContract[],
  fetched: SavedLookContract[],
  deletedIds: ReadonlySet<string>
): SavedLookContract[] {
  const seen = new Set(current.map((item) => item.id))
  return [
    ...current,
    ...fetched.filter((item) => !seen.has(item.id) && !deletedIds.has(item.id)),
  ]
}

async function confirmMobileSavedLookExists(
  existing: SavedLookContract,
  accessToken: string | undefined,
  deletedIds: ReadonlySet<string>,
  onVerifiedUnchanged: (verified: SavedLookContract) => void
): Promise<boolean> {
  try {
    const record = await getSavedLookFromMobile(existing.id, { accessToken })
    if (deletedIds.has(record.id)) return false
    onVerifiedUnchanged(record)
    return true
  } catch (error) {
    if (error instanceof MobileSavedLookRequestError && error.status === 404) {
      return false
    }
    throw error
  }
}

async function createMobileSavedLookWithKey(
  payload: NonNullable<ReturnType<typeof buildHomeSampleSavedLookInput>>,
  attemptKey: string,
  attemptKeys: Map<string, string>,
  accessToken: string | undefined
): Promise<SavedLookContract | null> {
  const idempotencyKey = attemptKeys.get(attemptKey) ?? createIdempotencyKey()
  attemptKeys.set(attemptKey, idempotencyKey)
  try {
    const created = await createSavedLookFromMobile(payload, {
      accessToken,
      idempotencyKey,
    })
    attemptKeys.delete(attemptKey)
    return created
  } catch (error) {
    if (error instanceof MobileSavedLookRequestError && error.status === 409) {
      attemptKeys.delete(attemptKey)
      if (error.code === 'SAVED_LOOK_ALREADY_REMOVED') return null
    }
    throw error
  }
}

async function ensureMobileOnlineForAction(
  readLiveOnline: () => boolean
): Promise<boolean> {
  if (readLiveOnline()) return true
  if (hasReliableBrowserOnline()) return false
  return checkNetworkOnlineForAction()
}

export function HomeAddGarment() {
  const { i18n } = useTranslation()
  const strings = getGuestPreviewStrings(i18n.language)
  const palette = useHeroPalette()
  useEffect(() => () => setMobilePrimaryActionClearance(0), [])
  return (
    <View
      testID="home-add-garment-container"
      onLayout={(event) => {
        const height = Math.ceil(event.nativeEvent.layout.height)
        if (height > 0) {
          setMobilePrimaryActionClearance(height + 8)
        }
      }}
    >
      <PreviewButton
        label={strings.firstUse.addGarment}
        testID="home-add-garment"
        palette={palette}
        onPress={() => router.navigate('/wardrobe?entry=add')}
        primary
      />
    </View>
  )
}

export function HomePlannerLink() {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  return (
    <View style={styles.plan}>
      <PreviewButton
        label={t('commerce.premium.planner.openControl')}
        testID="home-plan-week"
        palette={palette}
        onPress={() => router.push('/planner')}
      />
    </View>
  )
}

export function MemberSampleOutfit({
  owner,
  error,
  busy,
  onRetry,
}: {
  owner: string | null
  error: 'no-location' | 'generic' | null
  busy: boolean
  onRetry: () => void
}) {
  const { t, i18n } = useTranslation()
  const statusBar = useStatusBar()
  const locale = i18n.language
  const strings = getGuestPreviewStrings(locale)
  const palette = useHeroPalette()
  const [result, setResult] = useState(createMemberSampleOutfit)
  const [category, setCategory] = useState<SampleGarmentCategory | null>(null)
  const [savedLooks, setSavedLooks] = useState<SavedLookContract[]>([])
  const [bookmarkRevision, setBookmarkRevision] = useState(0)
  const [bookmarkStorage, setBookmarkStorage] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading')
  const savedLooksRef = useRef<SavedLookContract[]>([])
  savedLooksRef.current = savedLooks
  const saveAttemptKeysRef = useRef<Map<string, string>>(new Map())
  const lastCreatedRef = useRef<SavedLookContract | null>(null)
  const saveRunSeqRef = useRef(0)
  const deletedIdsRef = useRef<Set<string>>(new Set())
  const mutationVersionRef = useRef(0)
  const lookUndoStackRef = useRef<SampleOutfitResult[]>([])
  const noticeSeqRef = useRef(0)
  const statusBarRef = useRef(statusBar)
  statusBarRef.current = statusBar
  const updateResult = (
    updater: SampleOutfitResult | ((current: SampleOutfitResult) => SampleOutfitResult)
  ) => {
    saveRunSeqRef.current += 1
    setResult(updater)
  }
  const readLiveOnline = () => getNetworkOnline()
  const isLiveSession = (actionOwner: string | null, actionEpoch: number) =>
    Boolean(
      actionOwner &&
        mobileApplicationUserId() === actionOwner &&
        mobileIdentityEpoch() === actionEpoch
    )
  const showSampleActionError = (kind: string, error: unknown, retry?: () => void) => {
    const seq = ++noticeSeqRef.current
    const offline = isOfflineError(error) || !readLiveOnline()
    if (offline) reportNetworkOffline()
    statusBarRef.current.showNotice({
      id: `${kind}-${offline ? 'offline' : 'failed'}-${seq}`,
      announcementId: createAnnouncementToken(
        `${kind}-${offline ? 'offline' : 'failed'}`,
        seq
      ),
      message: offline ? t('feedback.offlineAction') : t('feedback.saveFailed'),
      tone: offline ? 'offline' : 'error',
      actions:
        !offline && retry
          ? [{ id: 'retry', kind: 'retry', label: t('feedback.retry'), onPress: retry }]
          : [],
    })
  }

  useEffect(() => {
    statusBarRef.current.dismissNotice()
    saveAttemptKeysRef.current.clear()
    deletedIdsRef.current.clear()
    saveRunSeqRef.current += 1
    lastCreatedRef.current = null
    if (!owner) {
      savedLooksRef.current = []
      setSavedLooks([])
      setBookmarkStorage('loading')
      return
    }
    const controller = new AbortController()
    const loadVersion = mutationVersionRef.current
    setBookmarkStorage('loading')
    void listSavedLooksFromMobile({ source: 'home_sample', signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted || mobileApplicationUserId() !== owner) {
          return
        }
        const next =
          mutationVersionRef.current === loadVersion
            ? items
            : mergeMobileInitialSavedLooks(
                savedLooksRef.current,
                items,
                deletedIdsRef.current
              )
        savedLooksRef.current = next
        setSavedLooks(next)
        setBookmarkStorage('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted && mutationVersionRef.current === loadVersion) {
          setBookmarkStorage('unavailable')
        }
      })
    return () => {
      controller.abort()
      statusBarRef.current.dismissNotice()
    }
  }, [owner])

  useEffect(() => {
    if (!owner) return
    return subscribeMobileSavedLooksChanged((changedOwner) => {
      if (changedOwner !== owner) return
      const refreshVersion = mutationVersionRef.current
      void listSavedLooksFromMobile({
        source: 'home_sample',
        skipLegacyImport: true,
      })
        .then((items) => {
          if (
            mobileApplicationUserId() !== owner ||
            mutationVersionRef.current !== refreshVersion
          ) {
            return
          }
          const next = mergeMobileInitialSavedLooks(
            savedLooksRef.current,
            items,
            deletedIdsRef.current
          )
          savedLooksRef.current = next
          setSavedLooks(next)
          setBookmarkStorage('ready')
        })
        .catch(() => undefined)
    })
  }, [owner])

  const bookmarks: (SampleBookmark & {
    savedLookId?: string
    needsReview?: boolean
  })[] = []
  for (const saved of savedLooks) {
    const bookmark = savedLookToSampleBookmark(saved)
    if (!bookmark) continue
    bookmarks.push({
      ...bookmark,
      savedLookId: saved.id,
      needsReview: saved.availabilityStatus === 'needs_review',
    })
  }
  const pushUndoAndUpdate = (next: SampleOutfitResult, message: string, kind: string) => {
    if (next === result) return
    lookUndoStackRef.current = pushLookUndoSnapshot(lookUndoStackRef.current, result)
    updateResult(next)
    const seq = ++noticeSeqRef.current
    statusBar.showNotice({
      id: `sample-${kind}-${seq}`,
      announcementId: createAnnouncementToken(`sample-${kind}`, seq),
      message,
      tone: 'neutral',
      actions: [
        {
          id: 'undo',
          kind: 'undo',
          label: t('feedback.undo'),
          onPress: () => {
            const { snapshot, rest } = popLookUndoSnapshot(lookUndoStackRef.current)
            lookUndoStackRef.current = rest
            if (snapshot) {
              updateResult(snapshot)
              const undoSeq = ++noticeSeqRef.current
              statusBar.showNotice({
                id: `sample-${kind}-undo-${undoSeq}`,
                announcementId: createAnnouncementToken(`sample-${kind}-undo`, undoSeq),
                message: t('feedback.undone'),
                tone: 'neutral',
              })
            }
          },
        },
      ],
    })
  }
  const lookId = result.look?.id
  const currentId = result.garments.find((garment) => garment.category === category)?.id
  const garmentsSignature = result.garments.map((garment) => garment.id).join(',')

  return (
    <View testID="member-sample-outfit" style={styles.sample}>
      <Text style={{ color: palette.mutedText }}>{strings.chrome.sampleLabel}</Text>
      <PreviewOutfit
        result={result}
        strings={strings}
        palette={palette}
        locale={locale}
        heading={strings.firstUse.outfitIdea}
        continuation={
          <>
            <HomeAddGarment />
            {error === 'no-location' && (
              <View testID="hero-no-location-state">
                <PreviewButton
                  label={strings.firstUse.setCity}
                  testID="hero-add-location"
                  palette={palette}
                  onPress={() => router.push('/locations?guided=1')}
                />
              </View>
            )}
            {error === 'generic' && (
              <View testID="hero-error-state">
                <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
                  {strings.firstUse.outfitFailed}
                </Text>
                <PreviewButton
                  label={strings.chrome.retry}
                  testID="hero-retry"
                  palette={palette}
                  disabled={busy}
                  onPress={onRetry}
                />
              </View>
            )}
          </>
        }
        noAlternative={result.eligibleLookIds.length < 2}
        onTryAnother={() =>
          pushUndoAndUpdate(
            rotateMemberSampleOutfit(result),
            t('feedback.lookUpdated'),
            'shuffle'
          )
        }
        onSwap={setCategory}
        swapCategory={category}
        onUndoSwaps={() => updateResult(undoMemberSampleSwaps)}
        onReviewChoices={() => {
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          updateResult(createMemberSampleOutfit())
        }}
        onResetChoices={() => {
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          updateResult(createMemberSampleOutfit())
        }}
      />
      <SampleIdeaControls
        strings={strings}
        palette={palette}
        preferences={result.input.preferences}
        onPreferences={(preferences) => {
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          updateResult((current) => updateMemberSampleOutfit(current, { preferences }))
        }}
        weather={result.input.weather}
        onWeather={(weather) => {
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          updateResult((current) => updateMemberSampleOutfit(current, { weather }))
        }}
        bookmarks={bookmarks}
        needsReviewLabel={t('savedLooks.needsReview')}
        lookId={owner && bookmarkStorage !== 'loading' ? lookId : undefined}
        persistent={bookmarkStorage === 'ready'}
        showStorageFailureWhenEmpty={bookmarkStorage === 'unavailable'}
        ownerKey={owner}
        useSharedFeedback
        requiresNetwork
        saveResetKey={`${owner ?? 'anon'}:${lookId ?? 'none'}:${garmentsSignature}:${result.input.weather}:${JSON.stringify(result.input.preferences)}:${bookmarkRevision}`}
        onSave={async () => {
          const actionEpoch = mobileIdentityEpoch()
          if (!lookId || !isLiveSession(owner, actionEpoch) || !owner) return false
          const saveSeq = ++saveRunSeqRef.current
          lookUndoStackRef.current = []
          const payload = buildHomeSampleSavedLookInput(result)
          if (!payload) return false
          const actionToken = (await resolveMobileAccessToken()) ?? undefined
          if (!isLiveSession(owner, actionEpoch)) return false
          const existingMatch = savedLooksRef.current.find((item) =>
            savedLookMatchesHomeSample(item, result)
          )
          if (existingMatch) {
            const checkVersion = mutationVersionRef.current
            const verified = await confirmMobileSavedLookExists(
              existingMatch,
              actionToken,
              deletedIdsRef.current,
              (record) => {
                if (mutationVersionRef.current !== checkVersion) return
                const refreshed = [
                  record,
                  ...savedLooksRef.current.filter((item) => item.id !== record.id),
                ]
                savedLooksRef.current = refreshed
                setSavedLooks(refreshed)
              }
            )
            if (!isLiveSession(owner, actionEpoch)) return false
            if (verified) {
              if (saveRunSeqRef.current === saveSeq) lastCreatedRef.current = null
              setBookmarkStorage('ready')
              return { saved: true, undoable: false }
            }
            deletedIdsRef.current.add(existingMatch.id)
            const pruned = savedLooksRef.current.filter(
              (item) => item.id !== existingMatch.id
            )
            savedLooksRef.current = pruned
            setSavedLooks(pruned)
          }
          const attemptKey = buildMobileSampleAttemptKey(
            owner,
            lookId,
            garmentsSignature,
            result.input.weather,
            payload
          )
          const created = await createMobileSavedLookWithKey(
            payload,
            attemptKey,
            saveAttemptKeysRef.current,
            actionToken
          )
          if (!created || !isLiveSession(owner, actionEpoch)) return false
          deletedIdsRef.current.delete(created.id)
          mutationVersionRef.current += 1
          if (saveRunSeqRef.current === saveSeq) {
            lastCreatedRef.current = created
          }
          const next = [
            created,
            ...savedLooksRef.current.filter((item) => item.id !== created.id),
          ]
          savedLooksRef.current = next
          setSavedLooks(next)
          setBookmarkStorage('ready')
          notifyMobileSavedLooksChanged(owner)
          return true
        }}
        onUndoSave={async () => {
          const actionEpoch = mobileIdentityEpoch()
          const created = lastCreatedRef.current
          if (!created || !isLiveSession(owner, actionEpoch) || !owner) return false
          const actionToken = (await resolveMobileAccessToken()) ?? undefined
          if (!isLiveSession(owner, actionEpoch)) return false
          try {
            await deleteSavedLookFromMobile(
              created.id,
              formatSavedLookIfMatch(created.id, created.revision),
              { accessToken: actionToken }
            )
          } catch (error) {
            if (!(error instanceof MobileSavedLookRequestError && error.status === 404)) {
              throw error
            }
          }
          if (!isLiveSession(owner, actionEpoch)) return false
          deletedIdsRef.current.add(created.id)
          mutationVersionRef.current += 1
          lastCreatedRef.current = null
          const next = savedLooksRef.current.filter((item) => item.id !== created.id)
          savedLooksRef.current = next
          setSavedLooks(next)
          notifyMobileSavedLooksChanged(owner)
          return true
        }}
        onOpen={(bookmark) => {
          const matching = savedLooksRef.current.find(
            (item) => item.lookId === bookmark.lookId
          )
          if (matching?.availabilityStatus === 'needs_review') {
            const seq = ++noticeSeqRef.current
            statusBar.showNotice({
              id: `sample-${owner}-needs-review-${seq}`,
              announcementId: createAnnouncementToken(
                `sample-${owner}-needs-review`,
                seq
              ),
              message: t('savedLooks.needsReviewDetail'),
              tone: 'neutral',
              actions: [],
            })
            return
          }
          lookUndoStackRef.current = []
          statusBar.dismissNotice()
          updateResult((current) => reopenMemberSampleOutfit(current, bookmark))
        }}
        onRemove={(id) => {
          const runUndoRemove = async (
            target: SavedLookContract,
            actionOwner: string,
            actionEpoch: number,
            actionToken: string | undefined
          ) => {
            if (!isLiveSession(actionOwner, actionEpoch)) return
            const reachable = await ensureMobileOnlineForAction(readLiveOnline)
            if (!isLiveSession(actionOwner, actionEpoch)) return
            if (!reachable) {
              showSampleActionError(
                'sample-remove-undo',
                new TypeError('Failed to fetch')
              )
              return
            }
            try {
              const restored = await restoreSavedLookFromMobile(target.id, {
                accessToken: actionToken,
              })
              if (!isLiveSession(actionOwner, actionEpoch)) return
              mutationVersionRef.current += 1
              const restoredList = [
                restored,
                ...savedLooksRef.current.filter((item) => item.id !== restored.id),
              ]
              savedLooksRef.current = restoredList
              setSavedLooks(restoredList)
              notifyMobileSavedLooksChanged(actionOwner)
              const undoSeq = ++noticeSeqRef.current
              statusBarRef.current.showNotice({
                id: `sample-remove-undo-${undoSeq}`,
                announcementId: createAnnouncementToken('sample-remove-undo', undoSeq),
                message: t('feedback.undone'),
                tone: 'neutral',
              })
            } catch (undoError) {
              if (!isLiveSession(actionOwner, actionEpoch)) return
              showSampleActionError('sample-remove-undo', undoError)
            }
          }
          const runRemove = async () => {
            const actionEpoch = mobileIdentityEpoch()
            const actionOwner = owner
            if (!actionOwner || !isLiveSession(actionOwner, actionEpoch)) return
            const reachable = await ensureMobileOnlineForAction(readLiveOnline)
            if (!isLiveSession(actionOwner, actionEpoch)) return
            if (!reachable) {
              showSampleActionError('sample-remove', new TypeError('Failed to fetch'))
              return
            }
            const actionToken = (await resolveMobileAccessToken()) ?? undefined
            if (!isLiveSession(actionOwner, actionEpoch)) return
            const target = savedLooksRef.current.find(
              (item) => item.id === id || item.lookId === id
            )
            if (!target) return
            setBookmarkRevision((value) => value + 1)
            let alreadyDeleted = false
            try {
              await deleteSavedLookFromMobile(
                target.id,
                formatSavedLookIfMatch(target.id, target.revision),
                { accessToken: actionToken }
              )
            } catch (error) {
              if (!isLiveSession(actionOwner, actionEpoch)) return
              if (error instanceof MobileSavedLookRequestError && error.status === 404) {
                alreadyDeleted = true
              } else {
                showSampleActionError('sample-remove', error, () => {
                  if (isLiveSession(actionOwner, actionEpoch)) void runRemove()
                })
                return
              }
            }
            if (!isLiveSession(actionOwner, actionEpoch)) return
            deletedIdsRef.current.add(target.id)
            mutationVersionRef.current += 1
            const next = savedLooksRef.current.filter((item) => item.id !== target.id)
            savedLooksRef.current = next
            setSavedLooks(next)
            notifyMobileSavedLooksChanged(actionOwner)
            let undoInFlight = false
            const seq = ++noticeSeqRef.current
            statusBarRef.current.showNotice({
              id: `sample-remove-${seq}`,
              announcementId: createAnnouncementToken('sample-remove', seq),
              message: t('feedback.removed'),
              tone: 'neutral',
              actions: alreadyDeleted
                ? []
                : [
                    {
                      id: 'undo',
                      kind: 'undo',
                      label: t('feedback.undo'),
                      onPress: async () => {
                        if (undoInFlight) return
                        undoInFlight = true
                        try {
                          await runUndoRemove(
                            target,
                            actionOwner,
                            actionEpoch,
                            actionToken
                          )
                        } finally {
                          undoInFlight = false
                        }
                      },
                    },
                  ],
            })
          }
          void runRemove()
        }}
      />
      <PreviewSwapSheet
        category={category}
        candidates={
          category ? sampleSwapCandidates(SAMPLE_CATALOG, category, result.input) : []
        }
        currentId={currentId}
        strings={strings}
        palette={palette}
        onChoose={(id) => {
          if (category) {
            pushUndoAndUpdate(
              swapMemberSampleGarment(result, category, id),
              t('feedback.pieceSwapped'),
              'swap'
            )
          }
          setCategory(null)
        }}
        onClose={() => setCategory(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  sample: { marginHorizontal: 16, marginTop: 12, gap: 8 },
  plan: { marginHorizontal: 16, marginTop: 8 },
})
