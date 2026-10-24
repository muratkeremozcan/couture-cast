// Story 6.4 owner: independently focusable native thread controls and modal feedback.
import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
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
import type {
  CommunityCommentDraft,
  CommunityCommentDrafts,
} from '@/src/features/community/community-comment-drafts'

// Android's non-translucent modal starts below the native status-bar inset.
function modalKeyboardOffset(): number {
  return Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0
}

/**
 * R46: reports once, as the sheet unmounts, while the composer is still attached. React
 * runs this wrapper's layout cleanup before it removes the composer's host node, so the
 * composer's own focus state is still live here, whatever blur the platform sends for
 * the removal itself.
 */
function ComposerUnmount({
  onUnmount,
  children,
}: {
  onUnmount: () => void
  children: React.ReactNode
}) {
  const latest = useRef(onUnmount)
  latest.current = onUnmount
  useLayoutEffect(() => () => latest.current(), [])
  return children
}

export function CommunityCommentsSheet({
  postId,
  state,
  drafts,
  member,
  locale,
  target,
  onClose,
}: {
  postId: string | null
  state: CommunityCommentsState
  /** The screen's in-memory copy of the member's own unsent comments (R46). */
  drafts: CommunityCommentDrafts
  /** The signed-in member the drafts belong to; null holds nothing. */
  member: string | null
  target?: {
    commentId: string
    parentId: string | null
    pageCursor: string | null
    parentPageCursor: string | null
  }
  locale: SupportedLocale
  onClose: () => void
}) {
  const { t } = useTranslation()
  const palette = useHeroPalette()
  const threadVersion = useSyncExternalStore(
    state.subscribe,
    state.getVersion,
    state.getVersion
  )
  const [reporting, setReporting] = useState<string | null>(null)
  const reportGeneration = useRef(0)
  const [reason, setReason] = useState<CommunityReportReason>('spam')
  const titleRef = useRef<Text>(null)
  const statusRef = useRef<Text>(null)
  const composerRef = useRef<TextInput>(null)
  const entries = useRef(new Map<string, View | null>())
  const focused = useRef<string | null>(null)
  const removedFocus = useRef<string | null>(null)
  const refocusComposer = useRef(false)
  const thread = state.current(postId ?? '__closed__')
  const focus = (ref: React.RefObject<Text | View | null>) => {
    const node = safeFindNodeHandle(ref.current)
    if (node) AccessibilityInfo.setAccessibilityFocus(node)
  }
  useEffect(() => {
    if (!postId) return
    setReporting(null)
    if (target) void state.loadTarget(postId, target)
    else void state.load(postId)
    void state.statuses(postId)
    return state.watchSubmissions(postId)
  }, [postId, state, target])
  useEffect(() => {
    // R46: an unverified-access hide unmounts the sheet mid-comment. On the next mount
    // for the same member and post, the held draft fills a composer the comment state
    // lost, and focus returns only to a composer that had it.
    refocusComposer.current = false
    if (!postId || !member) return
    const held = drafts.restore(member, postId)
    if (!held) return
    const current = state.current(postId).draft
    if (!current.body && !current.parentId)
      state.draft(postId, { body: held.body, parentId: held.parentId })
    if (!held.focused) return
    refocusComposer.current = true
    composerRef.current?.focus()
  }, [drafts, member, postId, state])
  useEffect(() => {
    if (!postId) return
    const announcement = state.consumeAnnouncement(postId)
    if (!announcement) return
    AccessibilityInfo.announceForAccessibility(t(announcement.key))
    if (announcement.key === 'community.comments.submitted') focus(statusRef)
  }, [postId, state, t, thread.announcement?.id])

  useEffect(() => {
    if (!target) return
    const items = [
      ...(thread.roots?.items ?? []),
      ...[...thread.replies.values()].flatMap((page) => page.items),
    ]
    const visible = items.some(
      (item) => item.id === target.commentId && !item.unavailable
    )
    if (focused.current === target.commentId) {
      if (!visible && removedFocus.current !== target.commentId) {
        removedFocus.current = target.commentId
        if (!composerRef.current?.isFocused()) {
          focus(titleRef)
          AccessibilityInfo.announceForAccessibility(t('community.comments.unavailable'))
        }
      }
      return
    }
    if (!visible) return
    const entry = entries.current.get(target.commentId)
    const node = entry ? safeFindNodeHandle(entry) : null
    if (node) {
      focused.current = target.commentId
      AccessibilityInfo.setAccessibilityFocus(node)
    }
  }, [target, thread.roots, thread.replies, threadVersion, t])

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
  const edit = (draft: Partial<Pick<CommunityCommentDraft, 'body' | 'parentId'>>) => {
    state.draft(postId, draft)
    if (member) drafts.remember(member, postId, draft)
  }
  const close = () => {
    if (member) drafts.forget(member, postId)
    onClose()
  }
  const submit = () => {
    Keyboard.dismiss()
    const submitted = state.current(postId)
    void state.submit(postId, locale).then(() => {
      // Only an accepted submission in this same thread releases the held copy. A reset
      // or eviction during the request leaves it for the sheet to give back.
      if (
        !member ||
        state.current(postId) !== submitted ||
        submitted.unresolved ||
        submitted.error
      )
        return
      const { body, parentId } = submitted.draft
      if (!body && !parentId) drafts.forget(member, postId)
      else drafts.remember(member, postId, { body, parentId })
    })
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
      ref={(node) => {
        entries.current.set(item.id, node)
      }}
      accessibilityLabel={[item.author, item.body].filter(Boolean).join('. ')}
      style={[styles.entry, { borderColor: palette.divider }]}
      accessible={Boolean(target && target.commentId === item.id)}
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
              edit({ parentId: item.id })
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
      onRequestClose={close}
      onShow={() => {
        // A native composer can only take focus once its modal is on screen.
        if (refocusComposer.current) {
          refocusComposer.current = false
          composerRef.current?.focus()
          return
        }
        if (!target) focus(titleRef)
      }}
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
            {button(t('community.comments.close'), close, false, 'comments-close')}
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
                {button(t('community.comments.cancel'), () => edit({ parentId: null }))}
              </View>
            )}
            <Text style={[styles.author, { color: palette.text }]}>
              {t('community.comments.compose')}
            </Text>
            <ComposerUnmount
              onUnmount={() => {
                if (member)
                  drafts.retainFocus(
                    member,
                    postId,
                    composerRef.current?.isFocused() ?? false
                  )
              }}
            >
              <TextInput
                ref={composerRef}
                testID="comment-body"
                accessibilityLabel={t('community.comments.compose')}
                value={thread.draft.body}
                multiline={false}
                returnKeyType="send"
                onChangeText={(body) => edit({ body })}
                onFocus={() => {
                  // Holds even an empty draft, so a focused composer keeps its focus.
                  if (member) drafts.remember(member, postId, {})
                }}
                onEndEditing={(event) => {
                  const body = event.nativeEvent.text
                  if (state.current(postId).draft.body === body)
                    edit({ body: body.normalize('NFC') })
                }}
                onSubmitEditing={submit}
                style={[
                  styles.input,
                  { color: palette.text, borderColor: palette.mutedText },
                ]}
              />
            </ComposerUnmount>
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
