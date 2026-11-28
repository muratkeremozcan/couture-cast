import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { CommunityRequestSuperseded } from '@couture/api-client'
import {
  communityPostCaptionSchema,
  communityPostTitleSchema,
  COMMUNITY_POST_TITLE_MAX_LENGTH,
  defaultSupportedLocale,
  supportedLocaleSchema,
  type CommunityFeedItem,
  type EmbeddedCommunityChallenge,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import {
  allocateCommunityLookFromMobile,
  communityFailureReason,
  communityRetryAfterSeconds,
  describeCommunityDraftFromMobile,
  generateIdempotencyKey,
  pickCommunityPhoto,
  publishCommunityLookFromMobile,
  type AllocatedCommunityLook,
  type CommunityPhotoAsset,
  type CommunityPublishState,
} from '@/src/lib/community'
import {
  EdgeToEdgeModal,
  LayerSwipeHandle,
  useModalInsets,
  type LayerFocusTarget,
} from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { useTokens } from '@/src/theme/tokens'
import { useGlyphBox } from '@/components/glyph-box'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { useComposeFieldReveal } from './compose-field-reveal'
import { useModalAnimation } from '@/src/hooks/use-modal-animation'

// Story CC-7.9 D2, D3: every color is a role. The main action is `primary` (gold), a checked
// box is `inverse` with `onInverse`, and an error is the danger panel (`dangerSurface`,
// `dangerLine`, `dangerInk`), which meets 4.5:1 in both schemes.

/**
 * The reason travels and the words do not: every message the community client can
 * throw is untranslated English, so the surface maps the reason onto a
 * `community.error.*` key instead of rendering `error.message`.
 *
 * This lives beside the compose sheet because the six files this task may touch
 * hold no shared module. It belongs in `apps/mobile/src/lib/` next to a matching
 * web helper; reported so it can be lifted there.
 */
export function communityErrorTranslation(
  error: unknown,
  fallbackKey: string,
  locale: SupportedLocale
): { key: string; options?: { time: string } } {
  switch (communityFailureReason(error)) {
    case 'signed_out':
      return { key: 'community.error.signedOut' }
    case 'age_gate':
      return { key: 'community.error.ageGate' }
    case 'rate_limited': {
      const retryAfterSeconds = communityRetryAfterSeconds(error)
      return typeof retryAfterSeconds === 'number'
        ? {
            key: 'community.error.rateLimitedUntil',
            options: { time: formatRetryTime(retryAfterSeconds, locale) },
          }
        : { key: 'community.error.rateLimited' }
    }
    case 'not_found':
      return { key: 'community.error.notFound' }
    case 'reason_changed':
      return { key: 'community.error.reasonChanged' }
    case 'self_report':
      return { key: 'community.error.selfReport' }
    case 'disabled':
      return { key: 'community.error.disabled' }
    case 'banned':
      return { key: 'community.error.banned' }
    case 'media_unavailable':
      return { key: 'community.error.mediaUnavailable' }
    case 'upload_failed':
      return { key: 'community.error.upload' }
    case 'permission_denied':
      return { key: 'community.validation.permissionDenied' }
    case 'picker_failed':
      return { key: 'community.validation.pickerFailed' }
    case 'image_too_small':
      return { key: 'community.validation.imageTooSmall' }
    // `cursor_invalid` has no case and no catalog string on purpose: the screen
    // recovers from it by restarting paging, so copy for it would be copy nobody
    // can ever be shown.
    default:
      return { key: fallbackKey }
  }
}

/** `Retry-After` is delta-seconds, rendered as a wall-clock time in the reader's locale. */
function formatRetryTime(retryAfterSeconds: number, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(Date.now() + retryAfterSeconds * 1000))
}

/** Narrows the live i18next language to a locale the moderation screener accepts. */
export function useResolvedCommunityLocale(language: string): SupportedLocale {
  return useMemo(() => {
    const parsed = supportedLocaleSchema.safeParse(language)
    return parsed.success ? parsed.data : defaultSupportedLocale
  }, [language])
}

interface ComposeCheckboxRowProps {
  testID: string
  checked: boolean
  label: string
  onToggle: () => void
}

function ComposeCheckboxRow({
  testID,
  checked,
  label,
  onToggle,
}: ComposeCheckboxRowProps) {
  const palette = useHeroPalette()
  const checkboxBox = useGlyphBox(22, false)
  return (
    <TouchableOpacity
      style={styles.confirmationRow}
      testID={testID}
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityLabel={label}
      onPress={onToggle}
    >
      <View
        style={[
          styles.checkbox,
          checkboxBox,
          {
            borderColor: checked ? palette.ink : palette.inkMuted,
            backgroundColor: checked ? palette.inverse : 'transparent',
          },
        ]}
      >
        {/* Shape, not colour: the check mark is what says confirmed. */}
        {checked ? (
          <Text style={[styles.checkboxMark, { color: palette.onInverse }]}>✓</Text>
        ) : null}
      </View>
      <Text style={[styles.confirmationText, { color: palette.ink }]}>{label}</Text>
    </TouchableOpacity>
  )
}

interface ComposeErrorPanelProps {
  testID: string
  message: string
  isAlert?: boolean
}

function ComposeErrorPanel({ testID, message, isAlert = false }: ComposeErrorPanelProps) {
  const palette = useHeroPalette()
  return (
    <View
      testID={testID}
      accessibilityRole={isAlert ? 'alert' : undefined}
      accessibilityLiveRegion={isAlert ? 'assertive' : 'none'}
      style={[
        styles.errorPanel,
        { backgroundColor: palette.dangerSurface, borderColor: palette.dangerLine },
      ]}
    >
      <Text style={[styles.errorText, { color: palette.dangerInk }]}>{message}</Text>
    </View>
  )
}

interface ComposePhotoSectionProps {
  /** Story 6.7b R20: reports the section's place in the scroll content. */
  onLayout?: (event: LayoutChangeEvent) => void
  asset: CommunityPhotoAsset | null
  isBusy: boolean
  onPick: () => void
}

function ComposePhotoSection({
  asset,
  isBusy,
  onPick,
  onLayout,
}: ComposePhotoSectionProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  return (
    <View style={styles.section} onLayout={onLayout}>
      <Text style={[styles.sectionLabel, { color: palette.ink }]}>
        {t('community.compose.photoLabel')}
      </Text>
      <Text style={[styles.helperText, { color: palette.inkMuted }]}>
        {t('community.compose.photoHint')}
      </Text>
      {asset ? (
        <View style={styles.previewContainer}>
          <Image
            source={{ uri: asset.uri }}
            style={[styles.previewImage, { backgroundColor: palette.cardMuted }]}
            testID="community-post-preview-image"
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('community.compose.preview')}
          />
          <TouchableOpacity
            testID="community-change-image-button"
            style={[styles.outlineButton, { borderColor: palette.inkMuted }]}
            onPress={onPick}
            disabled={isBusy}
            accessibilityRole="button"
            aria-disabled={isBusy}
            accessibilityLabel={t('community.compose.changePhoto')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.ink }]}>
              {t('community.compose.changePhoto')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          testID="community-pick-image-button"
          style={[styles.pickImageButton, { borderColor: palette.inkMuted }]}
          onPress={onPick}
          disabled={isBusy}
          accessibilityRole="button"
          aria-disabled={isBusy}
          accessibilityLabel={t('community.compose.choosePhoto')}
        >
          <Text style={[styles.pickImageButtonText, { color: palette.ink }]}>
            {t('community.compose.choosePhoto')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

/** Story CC-7.11 D13: a draft with a photo or any text is worth asking about before it is dropped. */
function composeDraftDirty(draft: {
  asset: unknown
  caption: string
  title: string
  altText: string
}): boolean {
  return (
    draft.asset !== null ||
    [draft.caption, draft.title, draft.altText].some((text) => text.trim() !== '')
  )
}

export interface CommunityPostSheetProps {
  /** Pause new server actions during access revalidation; retain this owned draft and native host. */
  suspended?: boolean
  visible: boolean
  /** Active weekly challenge, when the feed carries one. */
  challenge?: EmbeddedCommunityChallenge | null
  /** True when the sheet was opened from the challenge CTA. */
  defaultChallengeOptIn?: boolean
  onClose: () => void
  onPublished: (post: CommunityFeedItem) => void
  /** Story CC-7.11 D13: the control that opened the layer; it takes focus back on close. */
  returnFocusRef?: LayerFocusTarget | null
}

function ChallengeInstructions({
  challenge,
  selected,
}: {
  challenge: EmbeddedCommunityChallenge
  selected: boolean
}) {
  const palette = useHeroPalette()
  if (!selected) return null
  return (
    <Text
      testID="community-post-challenge-instructions"
      style={[styles.helperText, { color: palette.inkMuted }]}
    >
      {challenge.body}
    </Text>
  )
}

export function CommunityPostSheet({
  visible,
  suspended = false,
  challenge = null,
  defaultChallengeOptIn = false,
  onClose,
  onPublished,
  returnFocusRef = null,
}: CommunityPostSheetProps) {
  const modalAnimation = useModalAnimation('slide')
  const { t, i18n } = useTranslation()
  const palette = useHeroPalette()
  const { scrim } = useTokens()
  const insets = useModalInsets()
  // Multilingual moderation screening needs the reader's real locale; the first
  // draft hardcoded 'en-US' and screened every non-English caption as English.
  const locale = useResolvedCommunityLocale(i18n.language)

  const [asset, setAsset] = useState<CommunityPhotoAsset | null>(null)
  const [allocated, setAllocated] = useState<AllocatedCommunityLook | null>(null)
  const [altText, setAltText] = useState('')
  const [altTextConfirmed, setAltTextConfirmed] = useState(false)
  const [{ caption, suggested }, setDescriptionDraft] = useState({
    caption: '',
    suggested: false,
  })
  const [descriptionStatus, setDescriptionStatus] = useState<
    'idle' | 'loading' | 'failed'
  >('idle')
  const description = useRef<AbortController | null>(null)
  const cancelDescription = useCallback(() => {
    description.current?.abort()
    description.current = null
  }, [])
  const invalidateDescription = useCallback(() => {
    cancelDescription()
    setDescriptionStatus('idle')
  }, [cancelDescription])
  const challengeId = challenge?.id
  useLayoutEffect(() => {
    setDescriptionStatus('idle')
    return cancelDescription
  }, [
    allocated,
    cancelDescription,
    challengeId,
    defaultChallengeOptIn,
    locale,
    suspended,
    visible,
  ])
  const [title, setTitle] = useState('')
  const titleInvalid =
    Boolean(title.trim()) && !communityPostTitleSchema.safeParse(title).success
  const [joinChallenge, setJoinChallenge] = useState(defaultChallengeOptIn)
  const [publishState, setPublishState] = useState<CommunityPublishState | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const sheetRef = useRef<View>(null)
  // Story 6.7b R16: keeps the focused field, its label row and counter inside
  // the scroll frame the keyboard shrinks (see `compose-field-reveal.ts`).
  const reveal = useComposeFieldReveal()
  const controllerRef = useRef<AbortController | null>(null)
  const access = useRef({ visible, suspended })
  access.current = { visible, suspended }
  const verificationWaiters = useRef(new Set<() => void>())
  useEffect(() => {
    if (!suspended) verificationWaiters.current.forEach((resume) => resume())
  }, [suspended])
  // One key per attempt, reused across allocate, upload, publish and any retry of
  // that attempt, so a retry replays the first session instead of allocating a second.
  const idempotencyKeyRef = useRef<string | null>(null)

  const resetState = useCallback(() => {
    invalidateDescription()
    controllerRef.current?.abort()
    controllerRef.current = null
    idempotencyKeyRef.current = null
    setAsset(null)
    setAllocated(null)
    setAltText('')
    setAltTextConfirmed(false)
    setDescriptionDraft({ caption: '', suggested: false })
    setTitle('')
    setPublishState(null)
    setIsBusy(false)
    setErrorMessage(null)
  }, [invalidateDescription])

  useEffect(() => {
    if (!visible) {
      resetState()
      return
    }
    setJoinChallenge(defaultChallengeOptIn)
    if (Platform.OS === 'web') {
      return
    }
    // Focus containment starts by moving the reader into the sheet; the screen
    // restores focus to the control that opened it once the sheet closes.
    const frame = requestAnimationFrame(() => {
      const node = safeFindNodeHandle(sheetRef.current)
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [defaultChallengeOptIn, resetState, visible])

  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    []
  )

  /**
   * Caption rules live on `communityPostCaptionSchema` in the contract. The local
   * URL_REGEX/EMAIL_REGEX copies are gone; only the mapping from a failed parse
   * onto a translated key lives here.
   */
  const captionErrorKey = useMemo((): string | null => {
    if (caption.length === 0) {
      return null
    }
    const result = communityPostCaptionSchema.safeParse(caption)
    if (result.success) {
      return null
    }
    if (caption.length > 280) {
      return 'community.validation.captionTooLong'
    }
    const issue = result.error.issues[0]?.message.toLowerCase() ?? ''
    return issue.includes('email')
      ? 'community.validation.captionEmail'
      : 'community.validation.captionUrl'
  }, [caption])

  const handleClose = useCallback(() => {
    resetState()
    onClose()
  }, [onClose, resetState])

  // Story CC-7.11 D13: X, system back and a swipe down share one guarded close. A draft with a
  // photo or any text asks before it is dropped; an empty one closes at once.
  const dirty = composeDraftDirty({ asset, caption, title, altText })
  // Story CC-7.11 D13 (busy guard): while a post publishes, X, back and swipe keep the sheet
  // open, so closing never abandons a publish half way.
  const publishing = publishState === 'publishing'
  const requestClose = useCallback(() => {
    if (publishing) return
    if (!dirty) {
      handleClose()
      return
    }
    Alert.alert(
      t('community.compose.discardTitle'),
      t('community.compose.discardMessage'),
      [
        { text: t('community.compose.discardKeep'), style: 'cancel' },
        {
          text: t('community.compose.discard'),
          style: 'destructive',
          onPress: handleClose,
        },
      ]
    )
  }, [dirty, handleClose, publishing, t])

  const handlePickImage = useCallback(async () => {
    if (access.current.suspended || !access.current.visible) return
    invalidateDescription()
    setErrorMessage(null)
    setIsBusy(true)
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const picked = await pickCommunityPhoto()
      if (!picked || controller.signal.aborted) {
        return
      }
      setAsset(picked)
      setDescriptionDraft((current) =>
        current.suggested ? { caption: '', suggested: false } : current
      )
      setAllocated(null)
      setAltText('')
      setAltTextConfirmed(false)

      // PHPicker can foreground the app before eligibility verification settles.
      // Keep the explicit selection locally while the current host is suspended.
      while (access.current.suspended) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            verificationWaiters.current.delete(resume)
            controller.signal.removeEventListener('abort', cancel)
          }
          const resume = () => {
            cleanup()
            resolve()
          }
          const cancel = () => {
            cleanup()
            reject(new Error('cancelled'))
          }
          verificationWaiters.current.add(resume)
          controller.signal.addEventListener('abort', cancel, { once: true })
          if (controller.signal.aborted) cancel()
        })
      }
      if (controller.signal.aborted || !access.current.visible) return
      const idempotencyKey = generateIdempotencyKey()
      idempotencyKeyRef.current = idempotencyKey

      // Allocate re-encodes the picked asset, checksums the bytes it is about to
      // send, uploads them and hands back the server's alt-text suggestion. The
      // first draft PUT the upload token as the body under a fake constant hash.
      const session = await allocateCommunityLookFromMobile({
        asset: picked,
        locale,
        idempotencyKey,
        signal: controller.signal,
        onStateChange: (state) => {
          if (!controller.signal.aborted) setPublishState(state)
        },
      })
      if (controller.signal.aborted) {
        return
      }
      setAllocated(session)
      setAltText(session.altTextSuggestion)
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return
      }
      const { key, options } = communityErrorTranslation(
        error,
        'community.error.upload',
        locale
      )
      setErrorMessage(t(key, options))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
      if (!controller.signal.aborted) {
        setPublishState(null)
        setIsBusy(false)
      }
    }
  }, [invalidateDescription, locale, t])

  const suggestDescription = async () => {
    if (!visible || suspended || isBusy || !allocated || caption || description.current)
      return
    const controller = new AbortController()
    description.current = controller
    setDescriptionStatus('loading')
    try {
      const proposedCaption = await describeCommunityDraftFromMobile(
        {
          postId: allocated.postId,
          uploadSessionId: allocated.uploadSessionId,
        },
        controller.signal
      )
      if (
        controller.signal.aborted ||
        !access.current.visible ||
        access.current.suspended
      )
        return
      setDescriptionDraft({ caption: proposedCaption, suggested: true })
      setDescriptionStatus('idle')
    } catch (error) {
      if (!controller.signal.aborted) {
        setDescriptionStatus(
          error instanceof CommunityRequestSuperseded ? 'idle' : 'failed'
        )
      }
    } finally {
      if (description.current === controller) description.current = null
    }
  }

  /**
   * Why publishing is blocked, as a catalog key, or `null` when it is not.
   *
   * One predicate serves the disabled state, the guard inside `handlePublish`
   * and the button's accessibility hint, so the three can never disagree about
   * what is wrong. The hint in particular used to name the alt-text confirmation
   * whatever the real blocker was, which is worse than saying nothing to a reader
   * who has not chosen a photo yet.
   */
  const publishBlockerKey = useMemo<string | null>(() => {
    if (!asset) return 'community.validation.photoRequired'
    // `allocated` and the idempotency key are written together, so the key needs
    // no separate clause here; `handlePublish` still narrows it for the compiler.
    if (!allocated) return 'community.error.upload'
    if (!altText.trim()) return 'community.validation.altRequired'
    if (!altTextConfirmed) return 'community.validation.altConfirmRequired'
    if (titleInvalid) return 'community.compose.titleInvalid'
    if (captionErrorKey) return captionErrorKey
    return null
  }, [allocated, altText, altTextConfirmed, asset, captionErrorKey, titleInvalid])

  const isPublishDisabled = publishBlockerKey !== null || isBusy || suspended

  const handlePublish = useCallback(async () => {
    if (suspended) return
    const session = allocated
    const idempotencyKey = idempotencyKeyRef.current
    // One guard, reading the same predicate the disabled state reads. It used to
    // be five, each restating a clause of `isPublishDisabled`: two expressions of
    // one rule, free to drift, and none of them reachable through the UI.
    if (publishBlockerKey !== null || !session || !idempotencyKey) {
      setErrorMessage(t(publishBlockerKey ?? 'community.error.upload'))
      return
    }

    invalidateDescription()
    setErrorMessage(null)
    setIsBusy(true)
    setPublishState('publishing')
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const post = await publishCommunityLookFromMobile({
        postId: session.postId,
        uploadSessionId: session.uploadSessionId,
        altText: altText.trim(),
        caption: caption.trim() || null,
        title: title.trim() || null,
        challengeId: challenge && joinChallenge ? challenge.id : null,
        locale,
        idempotencyKey,
        signal: controller.signal,
      })
      if (controller.signal.aborted) {
        return
      }
      onPublished(post)
      handleClose()
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return
      }
      const { key, options } = communityErrorTranslation(
        error,
        'community.error.publish',
        locale
      )
      setErrorMessage(t(key, options))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
      if (!controller.signal.aborted) {
        setPublishState(null)
        setIsBusy(false)
      }
    }
  }, [
    allocated,
    altText,
    caption,
    challenge,
    handleClose,
    invalidateDescription,
    joinChallenge,
    locale,
    onPublished,
    publishBlockerKey,
    suspended,
    t,
    title,
  ])

  const busyLabel =
    publishState === 'publishing'
      ? t('community.compose.publishing')
      : t('community.compose.uploading')

  return (
    <EdgeToEdgeModal
      testID="community-post-sheet"
      visible={visible}
      animationType={modalAnimation}
      onRequestClose={requestClose}
      returnFocusRef={returnFocusRef}
      scrim={scrim}
    >
      <View style={styles.overlay}>
        <View
          ref={sheetRef}
          testID="community-post-sheet-content"
          accessibilityViewIsModal
          accessibilityLabel={t('community.compose.title')}
          style={[
            styles.sheet,
            {
              backgroundColor: palette.page,
              borderColor: palette.line,
              paddingBottom: 24 + insets.bottom,
            },
          ]}
        >
          {/* Story CC-7.11 D13: the compose sheet is an overlay, so it keeps its X; its header
              is the swipe-down handle. */}
          <LayerSwipeHandle style={[styles.header, { borderBottomColor: palette.line }]}>
            <Text style={[styles.headerTitle, { color: palette.ink }]}>
              {t('community.compose.title')}
            </Text>
            <TouchableOpacity
              testID="community-post-sheet-close"
              style={styles.closeButton}
              onPress={requestClose}
              disabled={publishing}
              aria-disabled={publishing}
              accessibilityRole="button"
              accessibilityLabel={t('community.compose.close')}
            >
              <Text style={[styles.closeButtonText, { color: palette.ink }]}>✕</Text>
            </TouchableOpacity>
          </LayerSwipeHandle>

          <ScrollView
            {...reveal.scrollProps}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.helperText, { color: palette.inkMuted }]}>
              {t('community.compose.description')}
            </Text>

            {/* Photo */}
            <ComposePhotoSection
              onLayout={reveal.sectionLayout('photo')}
              asset={asset}
              isBusy={isBusy || suspended}
              onPick={() => {
                void handlePickImage()
              }}
            />
            {/* Alt text: server suggestion, author edit, explicit confirmation */}
            <View style={styles.section} onLayout={reveal.sectionLayout('alt')}>
              <Text style={[styles.sectionLabel, { color: palette.ink }]}>
                {t('community.compose.altLabel')}
              </Text>
              <Text style={[styles.helperText, { color: palette.inkMuted }]}>
                {allocated
                  ? t('community.compose.altSuggested')
                  : t('community.compose.altHint')}
              </Text>
              <TextInput
                testID="community-alt-text-input"
                style={[
                  styles.textInput,
                  { borderColor: palette.inkMuted, color: palette.ink },
                ]}
                placeholder={t('community.compose.altPlaceholder')}
                placeholderTextColor={palette.inkMuted}
                accessibilityLabel={t('community.compose.altLabel')}
                multiline
                maxLength={200}
                {...reveal.fieldFocus('alt')}
                value={altText}
                onChangeText={(next) => {
                  invalidateDescription()
                  setAltText(next)
                  // Editing the description withdraws the confirmation. Without this the
                  // wire carries altTextConfirmed: true for text nobody confirmed, and
                  // z.literal(true) still passes because the shape is intact.
                  setAltTextConfirmed(false)
                }}
              />

              <ComposeCheckboxRow
                testID="community-confirm-alt-text"
                checked={altTextConfirmed}
                label={t('community.compose.altConfirm')}
                onToggle={() => {
                  invalidateDescription()
                  setAltTextConfirmed((prev) => !prev)
                }}
              />
            </View>

            <View style={styles.section} onLayout={reveal.sectionLayout('title')}>
              <Text style={[styles.sectionLabel, { color: palette.ink }]}>
                {t('community.compose.titleLabel')}
              </Text>
              <TextInput
                testID="community-title-input"
                style={[
                  styles.textInput,
                  { borderColor: palette.inkMuted, color: palette.ink },
                ]}
                accessibilityLabel={t('community.compose.titleLabel')}
                {...reveal.fieldFocus('title')}
                value={title}
                maxLength={COMMUNITY_POST_TITLE_MAX_LENGTH}
                onChangeText={(value) => {
                  invalidateDescription()
                  setTitle(value)
                }}
              />
              {titleInvalid ? (
                <ComposeErrorPanel
                  testID="community-title-error"
                  message={t('community.compose.titleInvalid')}
                />
              ) : null}
            </View>

            {/* Caption */}
            <View style={styles.section} onLayout={reveal.sectionLayout('caption')}>
              <View style={styles.captionHeader}>
                <Text style={[styles.sectionLabel, { color: palette.ink }]}>
                  {t('community.compose.captionLabel')}
                </Text>
                <Text
                  style={[styles.countText, { color: palette.inkMuted }]}
                  testID="community-caption-count"
                >
                  {t('community.compose.captionCount', { count: caption.length })}
                </Text>
              </View>
              <TextInput
                testID="community-caption-input"
                style={[
                  styles.textInput,
                  { borderColor: palette.inkMuted, color: palette.ink },
                ]}
                placeholder={t('community.compose.captionPlaceholder')}
                placeholderTextColor={palette.inkMuted}
                accessibilityLabel={t('community.compose.captionLabel')}
                multiline
                {...reveal.fieldFocus('caption')}
                value={caption}
                onChangeText={(value) => {
                  invalidateDescription()
                  setDescriptionDraft({ caption: value, suggested: false })
                }}
              />
              <DraftDescriptionControl
                hasUpload={Boolean(allocated)}
                hasCaption={Boolean(caption)}
                suggested={suggested}
                suspended={suspended}
                isBusy={isBusy}
                status={descriptionStatus}
                onSuggest={() => void suggestDescription()}
                onAccept={() =>
                  setDescriptionDraft((current) => ({ ...current, suggested: false }))
                }
              />
              {captionErrorKey ? (
                <ComposeErrorPanel
                  testID="community-caption-error"
                  message={t(captionErrorKey)}
                />
              ) : null}
            </View>

            {/* Weekly challenge opt-in */}
            {challenge ? (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: palette.ink }]}>
                  {t('community.compose.challengeLabel')}
                </Text>
                <ComposeCheckboxRow
                  testID="community-post-challenge-toggle"
                  checked={joinChallenge}
                  label={
                    joinChallenge ? challenge.title : t('community.compose.challengeNone')
                  }
                  onToggle={() => {
                    invalidateDescription()
                    setJoinChallenge((prev) => !prev)
                  }}
                />
                <ChallengeInstructions challenge={challenge} selected={joinChallenge} />
              </View>
            ) : null}

            {isBusy ? (
              <View style={styles.statusRow} testID="community-publish-status">
                <ActivityIndicator size="small" color={palette.ink} />
                <Text style={[styles.helperText, { color: palette.inkMuted }]}>
                  {busyLabel}
                </Text>
              </View>
            ) : null}

            {errorMessage ? (
              <ComposeErrorPanel
                testID="community-publish-error"
                message={errorMessage}
                isAlert
              />
            ) : null}
          </ScrollView>
          {reveal.inView('caption') ? (
            // UI automation marker: the caption's label row, counter and field are
            // all inside the scroll view's visible frame, computed from the scroll
            // state, so it cannot report a field the frame clips. No label, no touches.
            <View
              testID="community-caption-in-view"
              collapsable={false}
              style={styles.marker}
            />
          ) : null}
          {reveal.inView('photo') ? (
            // Story 6.7b R20: the same marker for the photo section, so automation
            // can tell the photo is fully in view after the member scrolls to it.
            <View
              testID="community-photo-in-view"
              collapsable={false}
              style={styles.marker}
            />
          ) : null}

          <ComposeActions
            disabled={isPublishDisabled}
            busy={isBusy}
            suspended={suspended}
            blocker={publishBlockerKey}
            publish={() => {
              void handlePublish()
            }}
          />
        </View>
      </View>
    </EdgeToEdgeModal>
  )
}

function DraftDescriptionControl({
  hasUpload,
  hasCaption,
  suggested,
  suspended,
  isBusy,
  status,
  onSuggest,
  onAccept,
}: {
  hasUpload: boolean
  hasCaption: boolean
  suggested: boolean
  suspended: boolean
  isBusy: boolean
  status: 'idle' | 'loading' | 'failed'
  onSuggest: () => void
  onAccept: () => void
}) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const loading = status === 'loading'
  const disabled = loading || isBusy || suspended
  return (
    <>
      {hasUpload && !hasCaption && (
        <TouchableOpacity
          accessibilityRole="button"
          aria-disabled={disabled}
          aria-busy={loading}
          testID="community-suggest-description"
          disabled={disabled}
          onPress={onSuggest}
          style={[styles.descriptionButton, { borderColor: palette.line }]}
        >
          <Text style={{ color: palette.ink }}>
            {t(
              loading
                ? 'community.compose.descriptionWorking'
                : 'community.compose.suggestDescription'
            )}
          </Text>
        </TouchableOpacity>
      )}
      {suggested && (
        <View style={styles.suggestedDescriptionRow}>
          <Text
            accessibilityLiveRegion="polite"
            testID="community-description-suggested"
            style={[styles.helperText, { color: palette.inkMuted }]}
          >
            {t('community.compose.descriptionSuggested')}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            aria-disabled={isBusy || suspended}
            testID="community-accept-description"
            disabled={isBusy || suspended}
            onPress={onAccept}
            style={[styles.descriptionButton, { borderColor: palette.line }]}
          >
            <Text style={{ color: palette.ink }}>
              {t('community.compose.acceptDescription')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {status === 'failed' && (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.inkMuted }}>
          {t('community.compose.descriptionFailed')}
        </Text>
      )}
    </>
  )
}

function ComposeActions({
  disabled,
  busy,
  suspended,
  blocker,
  publish,
}: {
  disabled: boolean
  busy: boolean
  suspended: boolean
  blocker: string | null
  publish: () => void
}) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  return (
    <View style={styles.footer}>
      {suspended && (
        <Text
          testID="community-compose-verifying"
          accessibilityLiveRegion="polite"
          style={[styles.helperText, { color: palette.inkMuted }]}
        >
          {t('community.realtime.unavailable')}
        </Text>
      )}
      <TouchableOpacity
        testID="community-publish-button"
        style={[
          styles.publishButton,
          { backgroundColor: palette.primary },
          disabled && styles.publishButtonDisabled,
        ]}
        disabled={disabled}
        onPress={publish}
        accessibilityRole="button"
        accessibilityLabel={t('community.compose.publish')}
        // Why the control is dead, spoken rather than implied by dimming.
        accessibilityHint={blocker ? t(blocker) : undefined}
        aria-disabled={disabled}
        aria-busy={busy}
      >
        {busy ? (
          <ActivityIndicator size="small" color={palette.onPrimary} />
        ) : (
          <Text style={[styles.publishButtonText, { color: palette.onPrimary }]}>
            {t('community.compose.publish')}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  suggestedDescriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  descriptionButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 18,
  },
  // On the content container, so scroll offsets and the sections' layout share
  // one coordinate space.
  contentContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  marker: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    // The style form: react-native-web deprecates the `pointerEvents` prop.
    pointerEvents: 'none',
  },
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  previewContainer: {
    alignItems: 'stretch',
    gap: 8,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
  },
  outlineButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  outlineButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pickImageButton: {
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickImageButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  confirmationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    minHeight: 44,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  confirmationText: {
    fontSize: 12,
    flex: 1,
  },
  // Story 6.15 F-00i: at the largest text sizes the label and the counter no longer fit on one
  // line, so the counter wraps below the label instead of running past the sheet edge.
  captionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: 8,
  },
  countText: {
    fontSize: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  errorPanel: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  publishButton: {
    borderRadius: 8,
    paddingVertical: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishButtonDisabled: {
    opacity: 0.5,
  },
  publishButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
})
