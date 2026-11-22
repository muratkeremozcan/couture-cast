'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  COMMUNITY_POST_TEXT_REJECTED_MESSAGE,
  COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
  COMMUNITY_POST_TITLE_MAX_LENGTH,
  editCommunityPostTextInputSchema,
  type CommunityFeedItem,
  type EditCommunityPostTextResponse,
} from '@couture/api-client/contracts/http'
import { CommunityRequestError, editCommunityPostTextFromWeb } from '../../lib/community'
import { useStatusBar } from './save-feedback'

type SavedText = EditCommunityPostTextResponse['data']
type Translator = (key: string) => string
type OutcomeFeedbackKey = 'editSaved' | 'editNoChanges'

const inputClass =
  'min-h-11 w-full rounded border border-[color:var(--theme-card-border)] bg-[var(--lookbook-surface)] p-2 text-[color:var(--theme-card-text)]'
const buttonClass =
  'min-h-11 rounded border border-[color:var(--theme-card-border)] px-3 text-sm font-semibold disabled:opacity-50'

function editErrorKey(failure: unknown): string {
  if (!(failure instanceof CommunityRequestError)) return 'editFailed'
  const status = failure.httpStatus
  if (status === 409) return 'editConflict'
  if (status === 429) return 'editRateLimited'
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
  result: SavedText
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
  onStatus,
  t,
}: {
  item: CommunityFeedItem
  enabled: boolean
  onSaved: (postId: string, text: SavedText) => void
  onStatus?: (key: string) => void
  t: Translator
}) {
  const statusBar = useStatusBar()
  const [draft, setDraft] = useState<{
    title: string
    caption: string
    revision: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<OutcomeFeedbackKey | null>(null)
  const request = useRef<AbortController | null>(null)
  const feedbackSerial = useRef(0)
  const opener = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef(false)
  const isEditing = draft !== null

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!enabled && request.current) {
      request.current.abort()
      request.current = null
      setBusy(false)
    }
  }, [enabled])
  useEffect(() => {
    if (isEditing) field.current?.focus()
    else if (restoreFocus.current) {
      restoreFocus.current = false
      opener.current?.focus()
    }
    // Only when the editor opens or closes.
  }, [isEditing])

  function close() {
    restoreFocus.current = true
    setError(null)
    setDraft(null)
  }

  function reportOutcome(key: OutcomeFeedbackKey) {
    setFeedback(key)
    onStatus?.(`community.compose.${key}`)
    if (statusBar.hasProvider) {
      statusBar.showNotice({
        id: `community-edit-${item.id}-${++feedbackSerial.current}`,
        message: t(`community.compose.${key}`),
        tone: key === 'editSaved' ? 'success' : 'neutral',
      })
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || request.current || !enabled) return
    const input = editCommunityPostTextInputSchema.safeParse({
      title: draft.title.trim() || null,
      caption: draft.caption.trim() || null,
      baseRevision: draft.revision,
    })
    if (!input.success) {
      setError('editFailed')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(null)
    try {
      const text = await editCommunityPostTextFromWeb(
        item.id,
        input.data,
        controller.signal
      )
      if (controller.signal.aborted) return
      const unchanged = isUnchangedOutcome(item, draft.revision, text)
      if (!unchanged) onSaved(item.id, text)
      close()
      reportOutcome(unchanged ? 'editNoChanges' : 'editSaved')
    } catch (failure) {
      if (!controller.signal.aborted) setError(editErrorKey(failure))
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }

  if (
    !item.author.isSelf ||
    item.status !== 'published' ||
    item.textRevision === undefined
  )
    return null
  if (!draft)
    return (
      <div className="space-y-1.5">
        <button
          ref={opener}
          type="button"
          disabled={!enabled}
          data-testid="community-edit-text"
          className={buttonClass}
          onClick={() => {
            setFeedback(null)
            setDraft({
              title: item.title ?? '',
              caption: item.caption ?? '',
              revision: item.textRevision ?? 0,
            })
          }}
        >
          {t('community.compose.editText')}
        </button>
        {feedback && (
          <p
            data-testid="community-edit-status"
            className="text-xs text-[color:var(--lookbook-ink-muted)]"
          >
            {t(`community.compose.${feedback}`)}
          </p>
        )}
      </div>
    )

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="space-y-2"
      data-testid="community-edit-form"
    >
      <label className="block text-sm">
        {t('community.compose.titleLabel')}
        <input
          ref={field}
          disabled={busy}
          value={draft.title}
          maxLength={COMMUNITY_POST_TITLE_MAX_LENGTH}
          data-testid="community-edit-title"
          className={inputClass}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        {t('community.compose.captionLabel')}
        <textarea
          disabled={busy}
          value={draft.caption}
          maxLength={280}
          rows={3}
          data-testid="community-edit-description"
          className={inputClass}
          onChange={(event) => setDraft({ ...draft, caption: event.target.value })}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm">
          {t(`community.compose.${error}`)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={buttonClass}
          disabled={!enabled || busy}
          data-testid="community-edit-save"
        >
          {t(`community.compose.${busy ? 'savingText' : 'saveText'}`)}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={close}
          data-testid="community-edit-cancel"
        >
          {t('community.compose.cancel')}
        </button>
      </div>
    </form>
  )
}
