import React, { useEffect, useId, useRef, useState, type ElementRef } from 'react'
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  COMMUNITY_POST_TEXT_REJECTED_MESSAGE,
  COMMUNITY_POST_TEXT_SCREENING_BUSY_MESSAGE,
  COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
  COMMUNITY_POST_TITLE_MAX_LENGTH,
  editCommunityPostTextInputSchema,
  type CommunityFeedItem,
  type EditCommunityPostTextResponse,
} from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { useStatusBar } from '@/components/save-feedback'
import { PreviewButton } from '@/src/features/preview/guest-preview-parts'
import {
  CommunityRequestError,
  editCommunityPostTextFromMobile,
} from '@/src/lib/community'
import {
  mobileIdentityEpoch,
  subscribeMobileApplicationUser,
} from '@/src/lib/mobile-auth'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

export type SavedCommunityText = EditCommunityPostTextResponse['data']
type OutcomeFeedbackKey = 'editSaved' | 'editNoChanges'

function editErrorKey(failure: unknown): string {
  if (!(failure instanceof CommunityRequestError)) return 'editFailed'
  const status = failure.httpStatus
  if (status === 409) return 'editConflict'
  if (status === 429) {
    return failure.message.includes(COMMUNITY_POST_TEXT_SCREENING_BUSY_MESSAGE)
      ? 'editScreeningUnavailable'
      : 'editRateLimited'
  }
  if (status === 400 && failure.message.includes(COMMUNITY_POST_TEXT_REJECTED_MESSAGE)) {
    return 'editRejected'
  }
  if (
    status === 503 &&
    failure.message.includes(COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE)
  ) {
    return 'editScreeningUnavailable'
  }
  return 'editFailed'
}

function isUnchangedOutcome(
  item: CommunityFeedItem,
  baseRevision: number,
  result: SavedCommunityText
): boolean {
  return (
    result.textRevision === baseRevision &&
    result.title === (item.title?.trim() || null) &&
    result.caption === (item.caption?.trim() || null)
  )
}

export function CommunityPostTextEditor({
  item,
  enabled,
  onSaved,
}: {
  item: CommunityFeedItem
  enabled: boolean
  onSaved: (postId: string, text: SavedCommunityText) => void
}) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const statusBar = useStatusBar()
  const [draft, setDraft] = useState<{
    title: string
    caption: string
    version: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<OutcomeFeedbackKey | null>(null)
  const request = useRef<AbortController | null>(null)
  const feedbackId = useId()
  const feedbackSerial = useRef(0)
  const field = useRef<TextInput>(null)
  const opener = useRef<ElementRef<typeof Pressable>>(null)
  const restoreFocus = useRef(false)
  const canEdit =
    item.author.isSelf && item.status === 'published' && item.textRevision !== undefined
  const active = enabled && canEdit
  const activeRef = useRef(active)
  activeRef.current = active
  const isEditing = draft !== null

  function retireRequest() {
    request.current?.abort()
    request.current = null
  }

  useEffect(() => {
    const unsubscribe = subscribeMobileApplicationUser(() => {
      retireRequest()
      restoreFocus.current = false
      setDraft(null)
      setError(null)
      setFeedback(null)
      setBusy(false)
    })
    return () => {
      retireRequest()
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!active) {
      retireRequest()
      setBusy(false)
    } else if (isEditing) {
      field.current?.focus()
    } else if (restoreFocus.current) {
      restoreFocus.current = false
      opener.current?.focus()
      const node = safeFindNodeHandle(opener.current)
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node)
    }
  }, [active, isEditing])

  function close() {
    restoreFocus.current = true
    setDraft(null)
    setError(null)
  }

  function reportOutcome(key: OutcomeFeedbackKey) {
    setFeedback(key)
    const message = t(`community.compose.${key}`)
    if (statusBar.hasProvider) {
      statusBar.showNotice({
        id: `community-edit-${feedbackId}-${++feedbackSerial.current}`,
        message,
        tone: key === 'editSaved' ? 'success' : 'neutral',
      })
    } else {
      AccessibilityInfo.announceForAccessibility(message)
    }
  }

  async function save() {
    if (!draft || request.current || !activeRef.current) return
    const input = editCommunityPostTextInputSchema.safeParse({
      title: draft.title.trim() || null,
      caption: draft.caption.trim() || null,
      baseRevision: draft.version,
    })
    if (!input.success) {
      setError('editFailed')
      return
    }
    const controller = new AbortController()
    const epoch = mobileIdentityEpoch()
    const current = () =>
      !controller.signal.aborted && activeRef.current && epoch === mobileIdentityEpoch()
    request.current = controller
    setBusy(true)
    setError(null)
    try {
      const result = await editCommunityPostTextFromMobile(
        item.id,
        input.data,
        controller.signal
      )
      if (current()) {
        const unchanged = isUnchangedOutcome(item, draft.version, result)
        if (!unchanged) onSaved(item.id, result)
        close()
        reportOutcome(unchanged ? 'editNoChanges' : 'editSaved')
      }
    } catch (failure: unknown) {
      if (current()) setError(editErrorKey(failure))
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }

  if (!canEdit) return null
  if (!draft)
    return (
      <View style={styles.openerGroup}>
        <Pressable
          ref={opener}
          accessibilityRole="button"
          disabled={!active}
          accessibilityState={{ disabled: !active }}
          testID="community-edit-text"
          style={[
            styles.opener,
            { borderColor: palette.divider, opacity: active ? 1 : 0.5 },
          ]}
          onPress={() => {
            setFeedback(null)
            setDraft({
              title: item.title ?? '',
              caption: item.caption ?? '',
              version: item.textRevision ?? 0,
            })
          }}
        >
          <Text style={{ color: palette.text, textAlign: 'center', fontWeight: '600' }}>
            {t('community.compose.editText')}
          </Text>
        </Pressable>
        {feedback && (
          <Text
            testID="community-edit-status"
            style={[styles.feedback, { color: palette.mutedText }]}
          >
            {t(`community.compose.${feedback}`)}
          </Text>
        )}
      </View>
    )

  const fieldStyle = [styles.field, { borderColor: palette.divider, color: palette.text }]
  return (
    <View style={styles.form} testID="community-edit-form">
      <Text style={{ color: palette.text }}>{t('community.compose.titleLabel')}</Text>
      <TextInput
        ref={field}
        value={draft.title}
        onChangeText={(title) => setDraft({ ...draft, title })}
        maxLength={COMMUNITY_POST_TITLE_MAX_LENGTH}
        accessibilityLabel={t('community.compose.titleLabel')}
        style={fieldStyle}
        testID="community-edit-title"
        editable={active && !busy}
      />
      <Text style={{ color: palette.text }}>{t('community.compose.captionLabel')}</Text>
      <TextInput
        value={draft.caption}
        onChangeText={(caption) => setDraft({ ...draft, caption })}
        maxLength={280}
        multiline
        accessibilityLabel={t('community.compose.captionLabel')}
        style={fieldStyle}
        testID="community-edit-description"
        editable={active && !busy}
      />
      {error && (
        <Text accessibilityRole="alert" style={{ color: palette.danger }}>
          {t(`community.compose.${error}`)}
        </Text>
      )}
      <PreviewButton
        palette={palette}
        label={t(`community.compose.${busy ? 'savingText' : 'saveText'}`)}
        testID="community-edit-save"
        disabled={!active || busy}
        onPress={() => void save()}
        primary
      />
      <PreviewButton
        palette={palette}
        label={t('community.compose.cancel')}
        testID="community-edit-cancel"
        disabled={!active || busy}
        onPress={close}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  openerGroup: { gap: 6 },
  opener: {
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
    padding: 8,
  },
  feedback: { fontSize: 12 },
  form: { gap: 8 },
  field: { borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 8 },
})
