// Story 6.4 owner: independently focusable native thread controls and modal feedback.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { CommunityCommentsState } from '@couture/api-client'
import {
  communityReportReasonSchema,
  type CommunityComment,
  type CommunityReportReason,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

// Android's non-translucent modal starts below the native status-bar inset.
function modalKeyboardOffset(): number {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0
}

export function CommunityCommentsSheet({
  postId,
  state,
  locale,
  onClose,
}: {
  postId: string | null
  state: CommunityCommentsState
  locale: SupportedLocale
  onClose: () => void
}) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  useSyncExternalStore(state.subscribe, state.getVersion, state.getVersion)
  const [reporting, setReporting] = useState<string | null>(null)
  const reportGeneration = useRef(0)
  const [reason, setReason] = useState<CommunityReportReason>('spam')
  const titleRef = useRef<Text>(null)
  const statusRef = useRef<Text>(null)
  const composerRef = useRef<TextInput>(null)
  const thread = state.current(postId ?? '__closed__')
  const focus = (ref: React.RefObject<Text | View | null>) => {
    const node = safeFindNodeHandle(ref.current)
    if (node) AccessibilityInfo.setAccessibilityFocus(node)
  }
  useEffect(() => {
    if (!postId) return
    setReporting(null)
    void state.load(postId)
    void state.statuses(postId)
    return state.watchSubmissions(postId)
  }, [postId, state])
  useEffect(() => {
    if (!postId) return
    const announcement = state.consumeAnnouncement(postId)
    if (!announcement) return
    AccessibilityInfo.announceForAccessibility(t(announcement.key))
    if (announcement.key === 'community.comments.submitted') focus(statusRef)
  }, [postId, state, t, thread.announcement?.id])

  if (!postId) return null
  const button = (
    label: string,
    action: () => void,
    disabled = false,
    testID?: string,
    accessibleLabel = label
  ) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibleLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      onPress={action}
      style={[
        styles.button,
        { borderColor: palette.divider, opacity: disabled ? 0.6 : 1 },
        testID === 'comment-submit' && {
          backgroundColor: '#C9A14A',
          borderColor: '#C9A14A',
        },
      ]}
    >
      <Text style={{ color: testID === 'comment-submit' ? '#000000' : palette.text }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
  const submit = () => {
    Keyboard.dismiss()
    void state.submit(postId, locale)
  }
  const context = (item: CommunityComment) =>
    [item.author, item.unavailable ? t('community.comments.unavailable') : item.body]
      .filter(Boolean)
      .join('. ')
  const actionName = (action: string, item: CommunityComment) =>
    `${action}: ${context(item)}`
  const replyContext = () => {
    const root = thread.roots?.items.find((item) => item.id === thread.draft.parentId)
    return root ? `: ${context(root)}` : ''
  }

  const entry = (item: CommunityComment) => (
    <View
      key={item.id}
      testID={`comment-${item.id}`}
      style={[styles.entry, { borderColor: palette.divider }]}
      accessible={false}
    >
      {item.author && (
        <Text style={[styles.author, { color: palette.text }]}>{item.author}</Text>
      )}
      <Text style={{ color: palette.text }}>
        {item.unavailable ? t('community.comments.unavailable') : item.body}
      </Text>
      <View style={styles.row} accessible={false}>
        {!item.parentId &&
          !item.unavailable &&
          button(
            t('community.comments.reply'),
            () => {
              state.draft(postId, { parentId: item.id })
              composerRef.current?.focus()
            },
            false,
            `comment-reply-${item.id}`,
            actionName(t('community.comments.reply'), item)
          )}
        {item.isOwn &&
          button(
            t('community.comments.delete'),
            () => {
              void state.delete(postId, item.id)
            },
            false,
            undefined,
            actionName(t('community.comments.delete'), item)
          )}
        {button(
          t('community.card.report'),
          () => {
            reportGeneration.current++
            setReason('spam')
            setReporting(item.id)
          },
          item.isOwn,
          undefined,
          actionName(t('community.card.report'), item)
        )}
        {!item.parentId &&
          item.replyCount > 0 &&
          button(
            t('community.comments.replies', { count: item.replyCount }),
            () => {
              void state.load(postId, item.id)
            },
            false,
            `comment-replies-${item.id}`,
            actionName(t('community.comments.replies', { count: item.replyCount }), item)
          )}
      </View>
      {reporting === item.id && (
        <View accessible={false}>
          <Text style={{ color: palette.text }}>{t('community.report.reasonLabel')}</Text>
          {communityReportReasonSchema.options.map((option) => (
            <TouchableOpacity
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: reason === option }}
              aria-checked={reason === option}
              accessibilityLabel={t(`community.report.reason.${option}`)}
              style={[
                styles.button,
                { borderColor: reason === option ? '#C9A14A' : palette.divider },
              ]}
              onPress={() => setReason(option)}
            >
              <Text style={{ color: palette.text }}>
                {t(`community.report.reason.${option}`)}
              </Text>
            </TouchableOpacity>
          ))}
          {button(t('community.comments.sendReport'), () => {
            const owner = reportGeneration.current
            void state.report(postId, item.id, reason).then((accepted) => {
              if (accepted && reportGeneration.current === owner) {
                reportGeneration.current++
                setReporting(null)
              }
            })
          })}
          {button(t('community.comments.cancel'), () => {
            reportGeneration.current++
            setReporting(null)
          })}
        </View>
      )}
    </View>
  )

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => focus(titleRef)}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={modalKeyboardOffset()}
      >
        <View
          style={[styles.sheet, { backgroundColor: palette.surface }]}
          accessibilityViewIsModal
          accessible={false}
        >
          <View style={styles.row}>
            <Text
              ref={titleRef}
              accessibilityRole="header"
              style={[styles.title, { color: palette.text }]}
            >
              {t('community.comments.title')}
            </Text>
            {button(t('community.comments.close'), onClose, false, 'comments-close')}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.discussion}
            contentContainerStyle={styles.content}
            accessible={false}
          >
            {button(
              t('community.comments.refresh'),
              () => {
                void state.load(postId)
                void state.statuses(postId)
              },
              thread.loading
            )}
            {thread.roots?.hasNewer && (
              <Text style={{ color: palette.text }}>{t('community.comments.newer')}</Text>
            )}
            {thread.loading && (
              <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
                {t('community.comments.loading')}
              </Text>
            )}
            {thread.roots?.items.length === 0 && (
              <Text style={{ color: palette.text }}>{t('community.comments.empty')}</Text>
            )}
            {thread.roots?.items.map((root) => (
              <View key={root.id} accessible={false}>
                {entry(root)}
                {thread.replies.has(root.id) && (
                  <View style={styles.replies} accessible={false}>
                    {thread.replies.get(root.id)?.items.map(entry)}
                    {thread.replies.get(root.id)?.nextCursor &&
                      button(
                        t('community.comments.moreReplies'),
                        () => {
                          void state.load(postId, root.id, true)
                        },
                        thread.loading
                      )}
                  </View>
                )}
              </View>
            ))}
            {thread.roots?.nextCursor &&
              button(
                t('community.comments.more'),
                () => {
                  void state.load(postId, null, true)
                },
                thread.loading
              )}
            <View accessible={false}>
              {thread.submissions.length > 0 && (
                <Text
                  ref={statusRef}
                  accessible={true}
                  accessibilityRole="header"
                  style={[styles.author, { color: palette.text }]}
                >
                  {t('community.comments.private')}
                </Text>
              )}
              {thread.submissions.map((item) => (
                <View
                  key={item.id}
                  testID={`comment-submission-${item.id}`}
                  style={[styles.entry, { borderColor: palette.divider }]}
                  accessible={false}
                >
                  <Text style={{ color: palette.text }}>
                    {t(`community.comments.status.${item.status}`)}
                  </Text>
                  {item.body && <Text style={{ color: palette.text }}>{item.body}</Text>}
                  {!['author_deleted', 'erased'].includes(item.status) &&
                    button(t('community.comments.delete'), () => {
                      void state.delete(postId, item.id)
                    })}
                  {[
                    'held_for_review',
                    'blocked',
                    'screening_failed',
                    'consent_suspended',
                  ].includes(item.status) && (
                    <Text style={{ color: palette.text }}>
                      {t('community.comments.recovery')}
                    </Text>
                  )}
                </View>
              ))}
              {thread.submissionsCursor &&
                button(t('community.comments.morePrivate'), () => {
                  void state.statuses(postId, true)
                })}
            </View>
          </ScrollView>
          <View style={styles.composer}>
            {thread.draft.parentId && (
              <View style={styles.row}>
                <Text style={{ color: palette.text }}>
                  {t('community.comments.replying')}
                  {replyContext()}
                </Text>
                {button(t('community.comments.cancel'), () =>
                  state.draft(postId, { parentId: null })
                )}
              </View>
            )}
            <Text style={[styles.author, { color: palette.text }]}>
              {t('community.comments.compose')}
            </Text>
            <TextInput
              ref={composerRef}
              testID="comment-body"
              accessibilityLabel={t('community.comments.compose')}
              value={thread.draft.body}
              multiline={false}
              returnKeyType="send"
              onChangeText={(body) => state.draft(postId, { body })}
              onEndEditing={(event) => {
                const body = event.nativeEvent.text
                if (state.current(postId).draft.body === body)
                  state.draft(postId, { body: body.normalize('NFC') })
              }}
              onSubmitEditing={submit}
              style={[
                styles.input,
                { color: palette.text, borderColor: palette.mutedText },
              ]}
            />
            <Text style={{ color: palette.text }}>
              {t('community.comments.count', {
                count: thread.draft.body.normalize('NFC').trim().length,
              })}
            </Text>
            {thread.unresolved && (
              <Text style={{ color: palette.text }}>
                {t('community.comments.unresolved')}
              </Text>
            )}
            {button(
              t(
                thread.pending
                  ? 'community.comments.sending'
                  : thread.unresolved
                    ? 'community.comments.retry'
                    : 'community.comments.send'
              ),
              submit,
              thread.pending,
              'comment-submit'
            )}
            {thread.error && (
              <Text style={{ color: palette.text }}>{t(thread.error)}</Text>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '90%',
    padding: 16,
    paddingBottom: 32,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  discussion: { flexShrink: 1 },
  content: { gap: 12, paddingBottom: 12 },
  composer: { gap: 12, paddingTop: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: {
    minHeight: 44,
    minWidth: 44,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
  },
  title: { fontSize: 22, fontWeight: '600', flexGrow: 1 },
  author: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  entry: { borderWidth: 1, borderRadius: 8, padding: 12, marginVertical: 4, gap: 8 },
  replies: { marginLeft: 16, paddingLeft: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, padding: 12 },
})
