import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  communityPostCaptionSchema,
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
  generateIdempotencyKey,
  pickCommunityPhoto,
  publishCommunityLookFromMobile,
  type AllocatedCommunityLook,
  type CommunityPhotoAsset,
  type CommunityPublishState,
} from '@/src/lib/community'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

/**
 * `hero-theme.ts` carries neither the premium gold accent nor the community
 * surface's merlot destructive colour, and this task may not extend it, so both
 * are derived here once and reported as a palette gap. Merlot is a fill with
 * white ink (10.2:1); as text on a dark ground it computes to 2.1:1 and fails.
 */
const ACCENT_GOLD = '#C9A14A'
const ON_ACCENT = '#111111'
const DESTRUCTIVE_MERLOT = '#7A1F2D'
const ON_DESTRUCTIVE = '#FFFFFF'

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
  return (
    <TouchableOpacity
      style={styles.confirmationRow}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      // Native-only on its own; see the note in `community-report-modal.tsx`.
      // Without this the web target rendered a checkbox with no `aria-checked`.
      aria-checked={checked}
      accessibilityLabel={label}
      onPress={onToggle}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: checked ? palette.text : palette.mutedText,
            backgroundColor: checked ? ACCENT_GOLD : 'transparent',
          },
        ]}
      >
        {/* Shape, not colour: the check mark is what says confirmed. */}
        {checked ? (
          <Text style={[styles.checkboxMark, { color: ON_ACCENT }]}>✓</Text>
        ) : null}
      </View>
      <Text style={[styles.confirmationText, { color: palette.text }]}>{label}</Text>
    </TouchableOpacity>
  )
}

interface ComposeErrorPanelProps {
  testID: string
  message: string
  isAlert?: boolean
}

function ComposeErrorPanel({ testID, message, isAlert = false }: ComposeErrorPanelProps) {
  return (
    <View
      testID={testID}
      accessibilityRole={isAlert ? 'alert' : undefined}
      accessibilityLiveRegion={isAlert ? 'assertive' : 'none'}
      style={[styles.errorPanel, { backgroundColor: DESTRUCTIVE_MERLOT }]}
    >
      <Text style={[styles.errorText, { color: ON_DESTRUCTIVE }]}>{message}</Text>
    </View>
  )
}

interface ComposePhotoSectionProps {
  asset: CommunityPhotoAsset | null
  isBusy: boolean
  onPick: () => void
}

function ComposePhotoSection({ asset, isBusy, onPick }: ComposePhotoSectionProps) {
  const { t } = useTranslation()
  const palette = useHeroPalette()

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: palette.text }]}>
        {t('community.compose.photoLabel')}
      </Text>
      <Text style={[styles.helperText, { color: palette.mutedText }]}>
        {t('community.compose.photoHint')}
      </Text>
      {asset ? (
        <View style={styles.previewContainer}>
          <Image
            source={{ uri: asset.uri }}
            style={[styles.previewImage, { backgroundColor: palette.skeleton }]}
            testID="community-post-preview-image"
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('community.compose.preview')}
          />
          <TouchableOpacity
            testID="community-change-image-button"
            style={[styles.outlineButton, { borderColor: palette.mutedText }]}
            onPress={onPick}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy }}
            accessibilityLabel={t('community.compose.changePhoto')}
          >
            <Text style={[styles.outlineButtonText, { color: palette.text }]}>
              {t('community.compose.changePhoto')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          testID="community-pick-image-button"
          style={[styles.pickImageButton, { borderColor: palette.mutedText }]}
          onPress={onPick}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          accessibilityLabel={t('community.compose.choosePhoto')}
        >
          <Text style={[styles.pickImageButtonText, { color: palette.text }]}>
            {t('community.compose.choosePhoto')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export interface CommunityPostSheetProps {
  visible: boolean
  /** Active weekly challenge, when the feed carries one. */
  challenge?: EmbeddedCommunityChallenge | null
  /** True when the sheet was opened from the challenge CTA. */
  defaultChallengeOptIn?: boolean
  onClose: () => void
  onPublished: (post: CommunityFeedItem) => void
}

export function CommunityPostSheet({
  visible,
  challenge = null,
  defaultChallengeOptIn = false,
  onClose,
  onPublished,
}: CommunityPostSheetProps) {
  const { t, i18n } = useTranslation()
  const palette = useHeroPalette()
  // Multilingual moderation screening needs the reader's real locale; the first
  // draft hardcoded 'en-US' and screened every non-English caption as English.
  const locale = useResolvedCommunityLocale(i18n.language)

  const [asset, setAsset] = useState<CommunityPhotoAsset | null>(null)
  const [allocated, setAllocated] = useState<AllocatedCommunityLook | null>(null)
  const [altText, setAltText] = useState('')
  const [altTextConfirmed, setAltTextConfirmed] = useState(false)
  const [caption, setCaption] = useState('')
  const [joinChallenge, setJoinChallenge] = useState(defaultChallengeOptIn)
  const [publishState, setPublishState] = useState<CommunityPublishState | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const sheetRef = useRef<View>(null)
  const controllerRef = useRef<AbortController | null>(null)
  // One key per attempt, reused across allocate, upload, publish and any retry of
  // that attempt, so a retry replays the first session instead of allocating a second.
  const idempotencyKeyRef = useRef<string | null>(null)

  const resetState = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    idempotencyKeyRef.current = null
    setAsset(null)
    setAllocated(null)
    setAltText('')
    setAltTextConfirmed(false)
    setCaption('')
    setPublishState(null)
    setIsBusy(false)
    setErrorMessage(null)
  }, [])

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

  useEffect(() => () => controllerRef.current?.abort(), [])

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

  const handlePickImage = useCallback(async () => {
    setErrorMessage(null)
    setIsBusy(true)
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const picked = await pickCommunityPhoto()
      if (!picked) {
        return
      }
      setAsset(picked)
      setAllocated(null)
      setAltText('')
      setAltTextConfirmed(false)

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
        onStateChange: setPublishState,
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
  }, [locale, t])

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
    if (captionErrorKey) return captionErrorKey
    return null
  }, [allocated, altText, altTextConfirmed, asset, captionErrorKey])

  const isPublishDisabled = publishBlockerKey !== null || isBusy

  const handlePublish = useCallback(async () => {
    const session = allocated
    const idempotencyKey = idempotencyKeyRef.current
    // One guard, reading the same predicate the disabled state reads. It used to
    // be five, each restating a clause of `isPublishDisabled`: two expressions of
    // one rule, free to drift, and none of them reachable through the UI.
    if (publishBlockerKey !== null || !session || !idempotencyKey) {
      setErrorMessage(t(publishBlockerKey ?? 'community.error.upload'))
      return
    }

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
    joinChallenge,
    locale,
    onPublished,
    publishBlockerKey,
    t,
  ])

  const busyLabel =
    publishState === 'publishing'
      ? t('community.compose.publishing')
      : t('community.compose.uploading')

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      testID="community-post-sheet"
    >
      <View style={styles.overlay}>
        <View
          ref={sheetRef}
          accessibilityViewIsModal
          accessibilityLabel={t('community.compose.title')}
          style={[
            styles.sheet,
            { backgroundColor: palette.surface, borderColor: palette.divider },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: palette.divider }]}>
            <Text style={[styles.headerTitle, { color: palette.text }]}>
              {t('community.compose.title')}
            </Text>
            <TouchableOpacity
              testID="community-post-sheet-close"
              style={styles.closeButton}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel={t('community.compose.close')}
            >
              <Text style={[styles.closeButtonText, { color: palette.text }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={[styles.helperText, { color: palette.mutedText }]}>
              {t('community.compose.description')}
            </Text>

            {/* Photo */}
            <ComposePhotoSection
              asset={asset}
              isBusy={isBusy}
              onPick={() => {
                void handlePickImage()
              }}
            />
            {/* Alt text: server suggestion, author edit, explicit confirmation */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: palette.text }]}>
                {t('community.compose.altLabel')}
              </Text>
              <Text style={[styles.helperText, { color: palette.mutedText }]}>
                {allocated
                  ? t('community.compose.altSuggested')
                  : t('community.compose.altHint')}
              </Text>
              <TextInput
                testID="community-alt-text-input"
                style={[
                  styles.textInput,
                  { borderColor: palette.mutedText, color: palette.text },
                ]}
                placeholder={t('community.compose.altPlaceholder')}
                placeholderTextColor={palette.mutedText}
                accessibilityLabel={t('community.compose.altLabel')}
                multiline
                maxLength={200}
                value={altText}
                onChangeText={(next) => {
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
                onToggle={() => setAltTextConfirmed((prev) => !prev)}
              />
            </View>

            {/* Caption */}
            <View style={styles.section}>
              <View style={styles.captionHeader}>
                <Text style={[styles.sectionLabel, { color: palette.text }]}>
                  {t('community.compose.captionLabel')}
                </Text>
                <Text
                  style={[styles.countText, { color: palette.mutedText }]}
                  testID="community-caption-count"
                >
                  {t('community.compose.captionCount', { count: caption.length })}
                </Text>
              </View>
              <TextInput
                testID="community-caption-input"
                style={[
                  styles.textInput,
                  { borderColor: palette.mutedText, color: palette.text },
                ]}
                placeholder={t('community.compose.captionPlaceholder')}
                placeholderTextColor={palette.mutedText}
                accessibilityLabel={t('community.compose.captionLabel')}
                multiline
                value={caption}
                onChangeText={setCaption}
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
                <Text style={[styles.sectionLabel, { color: palette.text }]}>
                  {t('community.compose.challengeLabel')}
                </Text>
                <ComposeCheckboxRow
                  testID="community-post-challenge-toggle"
                  checked={joinChallenge}
                  label={
                    joinChallenge ? challenge.title : t('community.compose.challengeNone')
                  }
                  onToggle={() => setJoinChallenge((prev) => !prev)}
                />
              </View>
            ) : null}

            {isBusy ? (
              <View style={styles.statusRow} testID="community-publish-status">
                <ActivityIndicator size="small" color={palette.text} />
                <Text style={[styles.helperText, { color: palette.mutedText }]}>
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

          <View style={styles.footer}>
            <TouchableOpacity
              testID="community-publish-button"
              style={[
                styles.publishButton,
                { backgroundColor: ACCENT_GOLD },
                isPublishDisabled && styles.publishButtonDisabled,
              ]}
              disabled={isPublishDisabled}
              onPress={() => {
                void handlePublish()
              }}
              accessibilityRole="button"
              accessibilityLabel={t('community.compose.publish')}
              // Why the control is dead, spoken rather than implied by dimming.
              accessibilityHint={publishBlockerKey ? t(publishBlockerKey) : undefined}
              accessibilityState={{ disabled: isPublishDisabled, busy: isBusy }}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={ON_ACCENT} />
              ) : (
                <Text style={[styles.publishButtonText, { color: ON_ACCENT }]}>
                  {t('community.compose.publish')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 24,
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
  content: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 13,
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
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  outlineButtonText: {
    fontSize: 13,
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
    padding: 10,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  confirmationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 15,
  },
  confirmationText: {
    fontSize: 12,
    flex: 1,
  },
  captionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  countText: {
    fontSize: 11,
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
    padding: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  publishButton: {
    borderRadius: 10,
    paddingVertical: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishButtonDisabled: {
    opacity: 0.5,
  },
  publishButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
})
