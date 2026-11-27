'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GarmentWithColor } from '@couture/api-client/contracts/http'
import { formatGarmentAlt, formatLocalizedList } from '@couture/utils'
import { getI18n } from '../../i18n'
import { isLiveScope } from '../../lib/use-web-session'
import { listGarmentsFromWeb } from '../../lib/wardrobe'
import { useScreenGateRead, useSectionSnapshot } from './screen-gate'

export function HomeCloset({ owner, scope }: { owner: string; scope: string }) {
  const { t, i18n } = useTranslation(undefined, { i18n: getI18n() })
  const { restored, beginRead, remember } = useSectionSnapshot<GarmentWithColor[] | null>(
    'recent-pieces',
    owner
  )
  const [pieces, setPieces] = useState(restored)
  useScreenGateRead('closet', pieces !== undefined)

  useEffect(() => {
    let controller: AbortController | undefined
    const read = () => {
      if (!isLiveScope(scope)) return
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
          setPieces(recent)
          remember(recent)
        })
        .catch(() => {
          if (!request.signal.aborted && isLiveScope(scope)) {
            setPieces(null)
            remember(null)
          }
        })
    }
    read()
    window.addEventListener('focus', read)
    return () => {
      controller?.abort()
      window.removeEventListener('focus', read)
    }
  }, [beginRead, remember, scope])

  if (!pieces) return null
  const recentLabel = t('home.today.recentPieces')
  const garments = formatLocalizedList(
    pieces.map((piece) => formatGarmentAlt(i18n.language, piece)),
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
      <span className="min-w-0 break-words">{recentLabel}</span>
      <span className="flex shrink-0 gap-1" aria-hidden="true">
        {pieces.map((piece) =>
          piece.imageAccess ? (
            <Image
              key={piece.id}
              src={piece.imageAccess.url}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="h-[32px] w-[32px] shrink-0 rounded-md bg-card-muted object-cover"
            />
          ) : (
            <span
              key={piece.id}
              className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md bg-card-muted"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M10 7a2 2 0 1 1 3 1.7l-1 .6v2m0 0-8 4.5a1 1 0 0 0 .5 1.9h15a1 1 0 0 0 .5-1.9l-8-4.5Z" />
              </svg>
            </span>
          )
        )}
        <span className="self-center">›</span>
      </span>
    </Link>
  )
}

const rowClass =
  'flex min-h-touch flex-wrap items-center justify-between gap-2 border-b border-line py-3 text-sm font-semibold text-ink'
