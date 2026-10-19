'use client'

// Story 6.4 owner: accessible comments inside the existing look detail dialog.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommunityCommentsState } from '@couture/api-client'
import {
  communityReportReasonSchema,
  resolveSupportedLocale,
  type CommunityComment,
  type CommunityReportReason,
} from '@couture/api-client/contracts/http'
import { getI18n } from '../../i18n'

const control =
  'min-h-[44px] min-w-[44px] rounded px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--theme-secondary)]'

export function CommunityComments({
  postId,
  state,
  focusOnOpen = false,
  onClose,
}: {
  postId: string
  state: CommunityCommentsState
  focusOnOpen?: boolean
  onClose?: () => void
}) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  useSyncExternalStore(state.subscribe, state.getVersion, state.getVersion)
  const thread = state.current(postId)
  const [reporting, setReporting] = useState<string | null>(null)
  const reportGeneration = useRef(0)
  const [announcement, setAnnouncement] = useState<{ key: string; id: number } | null>(
    null
  )
  const reasonRef = useRef<HTMLSelectElement>(null)
  const reportTriggers = useRef(new Map<string, HTMLButtonElement>())
  const [reason, setReason] = useState<CommunityReportReason>('spam')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const composing = useRef(false)
  const statusRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusOnOpen) {
      headingRef.current?.focus()
      headingRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [focusOnOpen, postId])
  useEffect(() => {
    void state.load(postId)
    void state.statuses(postId)
    return state.watchSubmissions(postId)
  }, [postId, state])
  useEffect(() => {
    const next = state.consumeAnnouncement(postId)
    if (!next) return
    setAnnouncement(next.key === thread.error ? null : next)
    if (next.key === 'community.comments.submitted') statusRef.current?.focus()
  }, [postId, state, thread.announcement?.id, thread.error])
  useEffect(() => {
    if (reporting) reasonRef.current?.focus()
  }, [reporting])
  const closeReport = (id: string) => {
    reportGeneration.current++
    setReporting(null)
    reportTriggers.current.get(id)?.focus()
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

  const refresh = () => {
    void state.load(postId)
    void state.statuses(postId)
  }
  const renderEntry = (item: CommunityComment) => (
    <article
      key={item.id}
      data-testid={`comment-${item.id}`}
      className="space-y-2 rounded-lg border border-[color:var(--theme-card-border)] p-3"
    >
      {item.author && <p className="text-sm font-semibold">{item.author}</p>}
      <p className="break-words text-sm">
        {item.unavailable ? t('community.comments.unavailable') : item.body}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {item.parentId === null && !item.unavailable && (
          <button
            type="button"
            className={control}
            aria-label={actionName(t('community.comments.reply'), item)}
            onClick={() => {
              state.draft(postId, { parentId: item.id })
              composerRef.current?.focus()
            }}
          >
            {t('community.comments.reply')}
          </button>
        )}
        {item.isOwn && (
          <button
            type="button"
            className={control}
            aria-label={actionName(t('community.comments.delete'), item)}
            onClick={() => {
              void state.delete(postId, item.id).then(() => statusRef.current?.focus())
            }}
          >
            {t('community.comments.delete')}
          </button>
        )}
        <button
          type="button"
          className={control}
          disabled={item.isOwn}
          ref={(element) => {
            if (element) reportTriggers.current.set(item.id, element)
            else reportTriggers.current.delete(item.id)
          }}
          aria-label={actionName(t('community.card.report'), item)}
          onClick={() => {
            reportGeneration.current++
            setReason('spam')
            setReporting(item.id)
          }}
        >
          {t('community.card.report')}
        </button>
        {item.parentId === null && item.replyCount > 0 && (
          <button
            type="button"
            className={control}
            aria-label={actionName(
              t('community.comments.replies', { count: item.replyCount }),
              item
            )}
            aria-expanded={thread.replies.has(item.id)}
            onClick={() => {
              void state.load(postId, item.id)
            }}
          >
            {t('community.comments.replies', { count: item.replyCount })}
          </button>
        )}
      </div>
      {reporting === item.id && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            const owner = reportGeneration.current
            void state.report(postId, item.id, reason).then((accepted) => {
              if (accepted && reportGeneration.current === owner) closeReport(item.id)
            })
          }}
        >
          <label className="block text-sm">
            {t('community.report.reasonLabel')}
            <select
              ref={reasonRef}
              className={`${control} block w-full border bg-[var(--theme-card-bg)]`}
              value={reason}
              onChange={(event) =>
                setReason(communityReportReasonSchema.parse(event.target.value))
              }
            >
              {communityReportReasonSchema.options.map((value) => (
                <option key={value} value={value}>
                  {t(`community.report.reason.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={control}>
            {t('community.comments.sendReport')}
          </button>
          <button type="button" className={control} onClick={() => closeReport(item.id)}>
            {t('community.comments.cancel')}
          </button>
        </form>
      )}
    </article>
  )

  return (
    <section
      aria-labelledby="community-comments-title"
      data-testid="community-comments"
      className="space-y-4 border-t border-[color:var(--theme-card-border)] pt-4 text-[color:var(--theme-card-text)]"
    >
      <div className="flex items-center justify-between gap-3">
        <h3
          ref={headingRef}
          tabIndex={-1}
          id="community-comments-title"
          className="font-semibold"
        >
          {t('community.comments.title')}
        </h3>
        {onClose && (
          <button type="button" className={control} onClick={onClose}>
            {t('community.card.detailClose')}
          </button>
        )}
        <button
          type="button"
          className={control}
          disabled={thread.loading}
          onClick={refresh}
        >
          {t('community.comments.refresh')}
        </button>
      </div>
      {thread.roots?.hasNewer && (
        <p className="text-sm">{t('community.comments.newer')}</p>
      )}
      {thread.loading && <p role="status">{t('community.comments.loading')}</p>}
      {thread.roots?.items.length === 0 && (
        <p className="text-sm">{t('community.comments.empty')}</p>
      )}
      <div className="space-y-3">
        {thread.roots?.items.map((root) => (
          <div key={root.id}>
            {renderEntry(root)}
            {thread.replies.has(root.id) && (
              <div className="ml-4 mt-2 space-y-2 border-l border-[color:var(--theme-card-border)] pl-3">
                {thread.replies.get(root.id)?.items.map(renderEntry)}
                {thread.replies.get(root.id)?.nextCursor && (
                  <button
                    type="button"
                    className={control}
                    disabled={thread.loading}
                    onClick={() => {
                      void state
                        .load(postId, root.id, true)
                        .then(() => headingRef.current?.focus())
                    }}
                  >
                    {t('community.comments.moreReplies')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {thread.roots?.nextCursor && (
        <button
          type="button"
          className={control}
          disabled={thread.loading}
          onClick={() => {
            void state.load(postId, null, true).then(() => headingRef.current?.focus())
          }}
        >
          {t('community.comments.more')}
        </button>
      )}
      <div
        ref={statusRef}
        role="region"
        tabIndex={-1}
        className="space-y-2 outline-offset-4"
        aria-label={t('community.comments.private')}
      >
        {thread.submissions.length > 0 && (
          <h4 className="text-sm font-semibold">{t('community.comments.private')}</h4>
        )}
        {thread.submissions.map((item) => (
          <article
            key={item.id}
            data-testid={`comment-submission-${item.id}`}
            className="rounded border border-[color:var(--theme-card-border)] p-3 text-sm"
          >
            <p>{t(`community.comments.status.${item.status}`)}</p>
            {item.body && <p className="break-words">{item.body}</p>}
            {!['author_deleted', 'erased'].includes(item.status) && (
              <button
                type="button"
                className={control}
                onClick={() => {
                  void state
                    .delete(postId, item.id)
                    .then(() => statusRef.current?.focus())
                }}
              >
                {t('community.comments.delete')}
              </button>
            )}
            {[
              'held_for_review',
              'blocked',
              'screening_failed',
              'consent_suspended',
            ].includes(item.status) && <p>{t('community.comments.recovery')}</p>}
          </article>
        ))}
        {thread.submissionsCursor && (
          <button
            type="button"
            className={control}
            onClick={() => {
              void state.statuses(postId, true).then(() => statusRef.current?.focus())
            }}
          >
            {t('community.comments.morePrivate')}
          </button>
        )}
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          void state.submit(postId, resolveSupportedLocale(i18n.language) ?? 'en-US')
        }}
      >
        {thread.draft.parentId && (
          <div className="flex items-center gap-2 text-sm">
            <span>
              {t('community.comments.replying')}
              {replyContext()}
            </span>
            <button
              type="button"
              className={control}
              onClick={() => {
                state.draft(postId, { parentId: null })
                composerRef.current?.focus()
              }}
            >
              {t('community.comments.cancel')}
            </button>
          </div>
        )}
        <label className="block text-sm font-medium" htmlFor={`comment-body-${postId}`}>
          {t('community.comments.compose')}
        </label>
        <input
          id={`comment-body-${postId}`}
          ref={composerRef}
          data-testid="comment-body"
          value={thread.draft.body}
          className="min-h-[44px] w-full rounded border border-[color:var(--theme-card-border)] bg-[var(--theme-card-bg)] px-3 text-[color:var(--theme-card-text)] focus:outline focus:outline-2 focus:outline-[color:var(--theme-secondary)]"
          onChange={(event) =>
            state.draft(postId, {
              body: composing.current
                ? event.target.value
                : event.target.value.normalize('NFC'),
            })
          }
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={(event) => {
            composing.current = false
            state.draft(postId, { body: event.currentTarget.value.normalize('NFC') })
          }}
          onBlur={(event) =>
            state.draft(postId, { body: event.currentTarget.value.normalize('NFC') })
          }
          aria-describedby={`comment-count-${postId}`}
        />
        <p id={`comment-count-${postId}`} className="text-xs">
          {t('community.comments.count', {
            count: thread.draft.body.normalize('NFC').trim().length,
          })}
        </p>
        {thread.unresolved && (
          <p className="text-sm">{t('community.comments.unresolved')}</p>
        )}
        <button
          type="submit"
          className={`${control} bg-[#C9A14A] text-[#111111]`}
          disabled={thread.pending}
        >
          {t(
            thread.pending
              ? 'community.comments.sending'
              : thread.unresolved
                ? 'community.comments.retry'
                : 'community.comments.send'
          )}
        </button>
      </form>
      {thread.error && <p role="alert">{t(thread.error)}</p>}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        <span key={announcement?.id}>{announcement ? t(announcement.key) : null}</span>
      </div>
    </section>
  )
}
