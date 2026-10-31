// Story 6.3 web owner: render the controls in `apps/web/src/app/components/community-reactions.tsx` and coordinate them in `apps/web/src/app/components/community-lookbook-grid.tsx`
'use client'

import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import type { ReactionControls } from '@couture/api-client'
import type { CommunityReactionFeedItem } from '@couture/api-client/contracts/http'
const choices = [
  { id: 'applause', emoji: '👏' },
  { id: 'love', emoji: '❤️' },
  { id: 'inspiration', emoji: '✨' },
] as const

/** Presentational controls. The screen retains requests and recovery state. */
export function CommunityReactions({
  item,
  controls,
  scope = '',
}: {
  item: CommunityReactionFeedItem
  controls: ReactionControls
  /** Test id prefix, so the City Spotlight's copy of a post stays addressable. */
  scope?: string
}) {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  const { pending, errorKey, canRetry, onSubmit } = controls
  const summary = item.reactions
  if (!summary) return null

  return (
    <div
      aria-busy={pending}
      data-focus-surface="light"
      className="space-y-2 rounded-lg bg-[var(--theme-card-bg)] p-2"
      data-testid={`${scope}community-reactions-${item.id}`}
    >
      <div
        role="group"
        aria-label={t('community.reactions.label')}
        className="flex flex-wrap gap-2"
      >
        {choices.map(({ id, emoji }) => (
          <button
            key={id}
            type="button"
            aria-pressed={summary.viewerReaction === id}
            aria-label={`${t(`community.reactions.${id}`)}, ${summary.counts[id]}`}
            aria-disabled={pending || canRetry}
            onClick={() => {
              onSubmit(id)
            }}
            className="min-h-[44px] min-w-[44px] rounded-full border border-[color:var(--theme-card-border)] px-3 text-xs text-[color:var(--theme-card-text)] aria-pressed:border-[color:var(--theme-secondary)] aria-pressed:bg-[#C9A14A] aria-pressed:text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-essential)] aria-disabled:opacity-60"
          >
            <span aria-hidden="true">
              {emoji} {summary.counts[id]}
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-600">
        {t('community.reactions.total', { count: summary.total })}
      </p>
      {pending && <p className="text-xs">{t('community.reactions.pending')}</p>}
      {errorKey && (
        <div className="text-xs text-[color:var(--theme-card-text)]">
          <p>{t(errorKey)}</p>
          {canRetry && (
            <button
              type="button"
              className="min-h-[44px] underline"
              onClick={() => {
                onSubmit()
              }}
            >
              {t('community.reactions.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
