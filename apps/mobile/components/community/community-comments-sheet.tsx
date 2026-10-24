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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type NativeScrollPoint,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import type { CommunityCommentsState } from '@couture/api-client'
import {
  communityReportReasonSchema,
  type CommunityComment,
  type CommunityReportReason,
  type SupportedLocale,
} from '@couture/api-client/contracts/http'
import { EdgeToEdgeModal, useModalInsets } from '@/components/edge-to-edge-modal'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import type {
  CommunityCommentDraft,
  CommunityCommentDrafts,
} from '@/src/features/community/community-comment-drafts'

/** The author and body that name a comment's actions and a reply's target. */
function commentContext(item: CommunityComment, unavailable: string): string {
  return [item.author, item.unavailable ? unavailable : item.body]
    .filter(Boolean)
    .join('. ')
}

/**
 * R52: how the keyboard view lifts the sheet. Android reports a closed keyboard at the
 * bottom of the visible frame, above the navigation bar, so there it acts only while the
 * keyboard is open; otherwise it would stay that much short of the full-screen modal.
 */
function keyboardAvoiding(keyboardOpen: boolean) {
  return {
    behavior: Platform.OS === 'ios' ? 'padding' : 'height',
    enabled: Platform.OS !== 'android' || keyboardOpen,
  } as const
}

/** R51: the thread region leaves the layout while the keyboard is open. */
function threadRegionStyle(keyboardOpen: boolean) {
  return [styles.discussion, keyboardOpen && styles.hidden]
}

/**
 * R51: whether the software keyboard is open. iOS reports the change as the keyboard
 * starts to move, so the thread region leaves with it; Android reports it once the
 * keyboard is up, the same event the KeyboardAvoidingView resizes on.
 */
function useKeyboardOpen(onShow: () => void): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => Keyboard.isVisible())
  const latestOnShow = useRef(onShow)
  latestOnShow.current = onShow
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const shown = Keyboard.addListener(
      ios ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        latestOnShow.current()
        setOpen(true)
      }
    )
    const hidden = Keyboard.addListener(
      ios ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setOpen(false)
    )
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  return [open, setOpen]
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
  const closedByMember = useRef(false)
  const thread = state.current(postId ?? '__closed__')
  // R51 layout rule: while the software keyboard is open the thread region is hidden,
  // with or without a reply target and at any window height. The title row, the reply
  // banner and the composer then own the space above the keyboard, so the region never
  // shows as a clipped sliver. It stays mounted, and returns when the keyboard closes at
  // the offset it had. Focus stays in the composer both ways; nothing here moves it.
  const threadOffset = useRef<NativeScrollPoint>({ x: 0, y: 0 })
  const [restoreOffset, setRestoreOffset] = useState<NativeScrollPoint>()
  // A native view the hidden region drops is rebuilt at the offset it had.
  const [keyboardOpen, setKeyboardOpen] = useKeyboardOpen(() =>
    setRestoreOffset({ ...threadOffset.current })
  )
  // R52: the sheet keeps clear of the gesture bar while the keyboard is down.
  const insets = useModalInsets(keyboardOpen)
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
    closedByMember.current = false
    if (!postId || !member) return
    const held = drafts.restore(member, postId)
    if (!held) return
    const current = state.current(postId).draft
    if (!current.body && !current.parentId)
      state.draft(postId, { body: held.body, parentId: held.parentId })
    // R47: a resend of a submission the wipe interrupted reuses its mutation ID.
    if (held.unresolved) state.resumeUnresolved(postId, held.unresolved)
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
  // R51: closing the keyboard keeps the sheet, and the thread region returns at once.
  const dismissKeyboard = () => {
    Keyboard.dismiss()
    setKeyboardOpen(false)
  }
  const close = () => {
    // Story 6.4: an explicit close keeps the unsent text, in the thread and held, for the
    // next open. That open starts on the title, so the composer is recorded unfocused.
    closedByMember.current = true
    onClose()
  }
  const submit = () => {
    Keyboard.dismiss()
    // The thread returns now, so the private status it holds can take focus on an
    // accepted submission even before the platform reports the keyboard closed.
    setKeyboardOpen(false)
    const submitted = state.current(postId)
    void state.submit(postId, locale).then(() => {
      // Only an outcome in this same thread updates the held copy. A reset or eviction
      // during the request leaves the draft and its mutation for the sheet to give back.
      if (!member || state.current(postId) !== submitted || submitted.unresolved) return
      // A definitive rejection keeps the draft for an edit and retires the mutation.
      if (submitted.error) {
        drafts.remember(member, postId, { unresolved: null })
        return
      }
      const { body, parentId } = submitted.draft
      if (!body && !parentId) drafts.forget(member, postId)
      else drafts.remember(member, postId, { body, parentId, unresolved: null })
    })
    // R47: the submission fixes its mutation ID before the request leaves. It is held
    // with the draft until this thread learns the outcome.
    if (member && submitted.unresolved)
      drafts.remember(member, postId, { unresolved: submitted.unresolved })
  }
  const context = (item: CommunityComment) =>
    commentContext(item, t('community.comments.unavailable'))
  const actionName = (action: string, item: CommunityComment) =>
    `${action}: ${context(item)}`
  const replying = () => {
    const root = thread.roots?.items.find((item) => item.id === thread.draft.parentId)
    const replyingTo = t('community.comments.replying')
    return root ? `${replyingTo}: ${context(root)}` : replyingTo
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
    <EdgeToEdgeModal
      visible
      animationType="slide"
      onRequestClose={() => {
        // R51: Back with the keyboard open closes the keyboard and keeps the sheet. On
        // Android 16 the modal otherwise takes that Back as a close request.
        if (!keyboardOpen) return close()
        dismissKeyboard()
      }}
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
      {/* R52: the scrim is its own full-screen layer, so the space the keyboard view gives
          up never shows the screen below. The modal window spans the whole screen on both
          platforms, so the keyboard's screen position needs no offset. */}
      <View testID="comments-scrim" style={styles.backdrop}>
        <KeyboardAvoidingView style={styles.avoider} {...keyboardAvoiding(keyboardOpen)}>
          <View
            testID="comments-sheet"
            style={[
              styles.sheet,
              { backgroundColor: palette.surface, paddingBottom: 32 + insets.bottom },
            ]}
            accessibilityViewIsModal
            accessible={false}
            // R51: iOS has no Back, the thread region is hidden and the return key sends,
            // so a tap on the sheet outside its controls closes the keyboard. Controls and
            // the composer take their own taps first.
            onStartShouldSetResponder={() => keyboardOpen}
            onResponderRelease={dismissKeyboard}
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
              testID="comments-thread"
              keyboardShouldPersistTaps="handled"
              style={threadRegionStyle(keyboardOpen)}
              contentContainerStyle={styles.content}
              contentOffset={restoreOffset}
              onScroll={(event) => {
                threadOffset.current = event.nativeEvent.contentOffset
              }}
              scrollEventThrottle={16}
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
                <Text style={{ color: palette.text }}>
                  {t('community.comments.newer')}
                </Text>
              )}
              {thread.loading && (
                <Text accessibilityLiveRegion="polite" style={{ color: palette.text }}>
                  {t('community.comments.loading')}
                </Text>
              )}
              {thread.roots?.items.length === 0 && (
                <Text style={{ color: palette.text }}>
                  {t('community.comments.empty')}
                </Text>
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
                    {item.body && (
                      <Text style={{ color: palette.text }}>{item.body}</Text>
                    )}
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
                  {/* R51: three lines at most on screen; the label keeps the whole context. */}
                  <Text
                    testID="comments-reply-context"
                    accessibilityLabel={replying()}
                    numberOfLines={3}
                    ellipsizeMode="tail"
                    style={{ color: palette.text }}
                  >
                    {replying()}
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
                      !closedByMember.current &&
                        (composerRef.current?.isFocused() ?? false)
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
      </View>
    </EdgeToEdgeModal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  discussion: { flexShrink: 1 },
  hidden: { display: 'none' },
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
