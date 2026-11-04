'use client'

// Story 6.11 web owner: what a banned member reads in place of the feed.
// It states the kind, the end and the appeal status. The reason, the moderator and the case stay private.
import type { CommunityBannedError } from '@couture/api-client/contracts/http'

type Translate = (key: string, options?: Record<string, unknown>) => string

export function CommunityBannedNotice({
  sanction,
  language,
  t,
}: {
  sanction: CommunityBannedError['sanction']
  language: string
  t: Translate
}) {
  const until = sanction.expiresAt
    ? new Intl.DateTimeFormat(language || 'en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(new Date(sanction.expiresAt))
    : null
  return (
    <section
      aria-labelledby="community-banned-title"
      data-testid="community-banned-notice"
      className="flex flex-col gap-3 rounded-lg border border-neutral-400 bg-white p-6 text-neutral-900"
    >
      <h2 id="community-banned-title" className="text-xl font-semibold">
        {t('community.banned.title')}
      </h2>
      <p>
        {until
          ? t('community.banned.temporary', { until })
          : t('community.banned.permanent')}
      </p>
      <p>{t('community.banned.scope')}</p>
      <p>{t(`community.banned.appeal.${sanction.appealStatus}`)}</p>
    </section>
  )
}
