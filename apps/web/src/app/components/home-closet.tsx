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

const recentReadIntervalMs = 60_000

export function HomeCloset({ owner, scope }: { owner: string; scope: string }) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const { restored, beginRead, remember } = useSectionSnapshot<boolean>(
    'recent-pieces',
    owner
  )
  const [pieces, setPieces] = useState<(GarmentCategory | null)[] | null>()
  const [pending, setPending] = useState(true)
  useScreenGateRead('closet', restored !== undefined || pieces !== undefined)

  useEffect(() => {
    let controller: AbortController | undefined
    let refresh: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      if (!isLiveScope(scope) || document.visibilityState === 'hidden') return
      controller?.abort()
      clearTimeout(refresh)
      setPending(true)
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
          remember(true)
        })
        .catch(() => {
          if (!request.signal.aborted && isLiveScope(scope)) {
            setPieces(null)
            remember(false)
          }
        })
        .finally(() => {
          if (request.signal.aborted || !isLiveScope(scope)) return
          setPending(false)
          refresh = setTimeout(read, recentReadIntervalMs)
        })
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') {
        read()
        return
      }
      controller?.abort()
      clearTimeout(refresh)
      setPending(true)
      setPieces((current) => (current === undefined ? undefined : null))
    }
    read()
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller?.abort()
      clearTimeout(refresh)
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [beginRead, remember, scope])

  if (pending) {
    return restored || pieces ? <div className="min-h-touch" aria-hidden="true" /> : null
  }
  if (!pieces) return null
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
