'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GarmentCategory } from '@couture/api-client/contracts/http'
import { formatGarmentAlt, formatLocalizedList } from '@couture/utils'
import { getI18n } from '../../i18n'
import { isLiveScope } from '../../lib/use-web-session'
import { listGarmentsFromWeb } from '../../lib/wardrobe'
import { useScreenGateRead, useSectionSnapshot } from './screen-gate'

export function HomeCloset({ owner, scope }: { owner: string; scope: string }) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const { restored, beginRead, remember } = useSectionSnapshot<
    (GarmentCategory | null)[]
  >('recent-pieces', owner)
  // The snapshot holds display categories only, scoped to the active member.
  const [pieces, setPieces] = useState<(GarmentCategory | null)[] | null | undefined>(
    restored
  )
  useScreenGateRead('closet', pieces !== undefined)

  useEffect(() => {
    let controller: AbortController | undefined
    const read = () => {
      if (!isLiveScope(scope) || document.visibilityState === 'hidden') return
      controller?.abort()
      beginRead()
      const request = new AbortController()
      controller = request
      void listGarmentsFromWeb(request.signal)
        .then((garments) => {
          if (request.signal.aborted || !isLiveScope(scope)) return
          const recent = [...garments]
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .slice(0, 3)
            .map(({ category }) => category)
          setPieces(recent)
          remember(recent)
        })
        .catch(() => {
          if (!request.signal.aborted && isLiveScope(scope)) {
            setPieces(null)
            remember(undefined)
          }
        })
    }
    read()
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => {
      controller?.abort()
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [beginRead, remember, scope])

  if (!pieces || !isLiveScope(scope)) return null
  const recentLabel = t('home.today.recentPieces')
  const garments = formatLocalizedList(
    pieces.map((category) => formatGarmentAlt(i18n.language, { category })),
    i18n.language
  )
  if (!pieces.length) {
    return (
      <Link
        href="/wardrobe?entry=add"
        data-testid="home-add-garment"
        className={rowClass}
      >
        {t('home.today.addFirstPiece')}
        <span aria-hidden="true">›</span>
      </Link>
    )
  }

  return (
    <Link
      href="/wardrobe"
      data-testid="home-closet-strip"
      aria-label={`${recentLabel}. ${garments}`}
      className={rowClass}
    >
      <span className="min-w-0 flex-1 break-words">
        {recentLabel}
        <span className="block text-xs font-normal text-ink-soft" aria-hidden="true">
          {garments}
        </span>
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  )
}

const rowClass =
  'flex min-h-touch flex-wrap items-center justify-between gap-2 border-b border-line py-3 text-sm font-semibold text-ink'
