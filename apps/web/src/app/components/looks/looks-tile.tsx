// Story CC-7.12 D2, D9 owner: the Looks picture tile. A 2 x 2 collage of a look's first four
// pieces, then its name and one state line. Saved looks and capsules are one link each; Ideas
// tiles are pictures with no control until CC-7.22 ships the lookbook.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  OutfitCapsuleContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  capsuleTileState,
  getGuestPreviewStrings,
  SAMPLE_CATALOG,
  sampleLookText,
  savedLookTileState,
  type LooksIdea,
  type LooksTileState,
  type SampleGarment,
} from '@couture/utils'
import { getI18n } from '../../../i18n'
import { SampleGarmentArt } from '../guest-preview/sample-garment-art'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

/** One collage cell: a member photo, catalog art or the dashed placeholder. */
export type LooksTileCell =
  | {
      readonly key: string
      readonly kind: 'photo'
      readonly url: string
      readonly expiresAt: string
    }
  | { readonly key: string; readonly kind: 'art'; readonly garment: SampleGarment }
  | { readonly key: string; readonly kind: 'placeholder' }

const usable = (expiresAt: string) => {
  const ms = Date.parse(expiresAt)
  return Number.isFinite(ms) && ms > Date.now()
}

/** A saved look's cells in slot order. */
export function savedLookCells(look: SavedLookContract): LooksTileCell[] {
  return [...look.composition]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .slice(0, 4)
    .map((slot): LooksTileCell => {
      const key = `${slot.slotIndex}:${slot.itemId}`
      if (slot.kind === 'catalog') {
        const garment = CATALOG_BY_ID.get(slot.itemId)
        return garment ? { key, kind: 'art', garment } : { key, kind: 'placeholder' }
      }
      if (slot.missing || !slot.imageAccess?.url || !usable(slot.imageAccess.expiresAt)) {
        return { key, kind: 'placeholder' }
      }
      return {
        key,
        kind: 'photo',
        url: slot.imageAccess.url,
        expiresAt: slot.imageAccess.expiresAt,
      }
    })
}

/** A capsule's cells in garment order. */
export function capsuleCells(capsule: OutfitCapsuleContract): LooksTileCell[] {
  return [...capsule.garments]
    .sort((a, b) => a.garmentOrder - b.garmentOrder)
    .slice(0, 4)
    .map((garment): LooksTileCell => {
      const key = `${garment.garmentOrder}:${garment.id}`
      if (
        garment.availabilityStatus !== 'ready' ||
        !garment.imageAccess?.url ||
        !usable(garment.imageAccess.expiresAt)
      ) {
        return { key, kind: 'placeholder' }
      }
      return {
        key,
        kind: 'photo',
        url: garment.imageAccess.url,
        expiresAt: garment.imageAccess.expiresAt,
      }
    })
}

/** The state line's text (D2). */
export function useLooksTileStateText(): (state: LooksTileState) => string {
  const { t, i18n } = useTranslation('translation', { i18n: getI18n() })
  return (state) => {
    if (state.kind === 'missing') return t('looks.state.missing', { count: state.count })
    if (state.kind === 'needsReview') return t('looks.state.needsReview')
    const date = new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: 'numeric',
    }).format(new Date(state.createdAt))
    return t('looks.state.savedOn', { date })
  }
}

/** A saved look's name: its title, else the sample look's name, else its look id. */
export function useSavedLookName(): (look: SavedLookContract) => string {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const samples = getGuestPreviewStrings(i18n.language)
  return (look) =>
    look.title || sampleLookText({ id: look.lookId }, samples).name || look.lookId
}

function Cell({ cell }: { cell: LooksTileCell }) {
  // A failed photo swaps to the placeholder inside the same square, so nothing moves (P8).
  const [failed, setFailed] = useState(false)
  const box = 'relative aspect-square overflow-hidden bg-card-muted'
  if (cell.kind === 'photo' && !failed) {
    return (
      <div className={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cell.url}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }
  if (cell.kind === 'art') {
    return (
      <div className={`${box} flex items-center justify-center p-2`}>
        <SampleGarmentArt garment={cell.garment} className="h-full w-full" />
      </div>
    )
  }
  return (
    <div
      data-testid="looks-tile-placeholder"
      className={`${box} border border-dashed border-line-strong`}
    />
  )
}

function Collage({ cells }: { cells: readonly LooksTileCell[] }) {
  const filled: (LooksTileCell | null)[] = [...cells]
  while (filled.length < 4) filled.push(null)
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-lg bg-line"
    >
      {filled.map((cell, index) =>
        cell ? (
          <Cell key={cell.key} cell={cell} />
        ) : (
          <div key={`empty-${index}`} className="aspect-square bg-card-muted" />
        )
      )}
    </div>
  )
}

function TileText({ name, line }: { name: string; line: string }) {
  return (
    <span className="mt-2 block min-w-0">
      <span className="block truncate text-sm font-semibold text-ink">{name}</span>
      <span className="block truncate text-xs text-ink-muted">{line}</span>
    </span>
  )
}

const TILE_CLASS =
  'block min-h-touch rounded-xl p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-essential'

/** A link tile (saved look or capsule). Its accessible name is the name and the state line. */
export function LooksLinkTile({
  href,
  testId,
  name,
  state,
  cells,
  onNavigate,
}: {
  href: string
  testId: string
  name: string
  state: LooksTileState
  cells: readonly LooksTileCell[]
  onNavigate?: () => void
}) {
  const stateText = useLooksTileStateText()
  const line = stateText(state)
  return (
    <Link
      href={href}
      data-testid={testId}
      aria-label={`${name}, ${line}`}
      className={TILE_CLASS}
      onClick={onNavigate}
    >
      <Collage cells={cells} />
      <TileText name={name} line={line} />
    </Link>
  )
}

export function SavedLookTile({ look, href }: { look: SavedLookContract; href: string }) {
  const name = useSavedLookName()
  return (
    <LooksLinkTile
      href={href}
      testId={`saved-look-card-${look.id}`}
      name={name(look)}
      state={savedLookTileState(look)}
      cells={savedLookCells(look)}
    />
  )
}

export function CapsuleTile({
  capsule,
  href,
}: {
  capsule: OutfitCapsuleContract
  href: string
}) {
  return (
    <LooksLinkTile
      href={href}
      testId={`looks-capsule-card-${capsule.id}`}
      name={capsule.name}
      state={capsuleTileState(capsule)}
      cells={capsuleCells(capsule)}
    />
  )
}

/** An Ideas tile: a picture with the look's name and its one-line description. */
export function IdeaTile({ idea }: { idea: LooksIdea }) {
  const { i18n } = useTranslation('translation', { i18n: getI18n() })
  const samples = getGuestPreviewStrings(i18n.language)
  const text = sampleLookText(idea.look, samples)
  const cells: LooksTileCell[] = idea.garments
    .slice(0, 4)
    .map((garment) => ({ key: garment.id, kind: 'art', garment }))
  return (
    <div data-testid={`looks-idea-card-${idea.look.id}`} className="p-1">
      <Collage cells={cells} />
      <TileText name={text.name} line={text.description} />
    </div>
  )
}

/** The two-column tile grid. */
export function LooksTileGrid({
  children,
  testId,
}: {
  children: ReactNode
  testId?: string
}) {
  return (
    <ul data-testid={testId} className="grid grid-cols-2 gap-3">
      {children}
    </ul>
  )
}
