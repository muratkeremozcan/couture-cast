// Story CC-7.12 D2, D9 owner: the native Looks picture tile. A 2 x 2 collage of a look's first
// four pieces, then its name and one state line. Saved looks and capsules are one link each;
// Ideas tiles are pictures with no control until CC-7.22 ships the lookbook.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import { Children, useState, type ReactNode } from 'react'
import { Image as ExpoImage } from 'expo-image'
import { useTranslation } from 'react-i18next'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
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
import { useTokens } from '@/src/theme/tokens'
import { usePhotoBeforeExpiry } from '@/src/hooks/use-photo-before-expiry'
import { SampleGarmentArt } from '../preview/guest-preview-parts'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

/** The catalog art's drawing size inside a collage cell. */
const CELL_ART_SIZE = 44

/** One collage cell: a member photo, catalog art or the dashed placeholder. */
export type LooksTileCell =
  | {
      readonly key: string
      readonly kind: 'photo'
      readonly url: string
      readonly ephemeral?: boolean
      readonly expiresAt?: number
    }
  | { readonly key: string; readonly kind: 'art'; readonly garment: SampleGarment }
  | { readonly key: string; readonly kind: 'placeholder' }

const usable = (expiresAt: string) => {
  const ms = Date.parse(expiresAt)
  return Number.isFinite(ms) && ms > Date.now()
}

/** A saved look's first four cells in slot order. */
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
        ephemeral: Boolean(look.wornOn),
        ...(look.wornOn ? { expiresAt: Date.parse(slot.imageAccess.expiresAt) } : {}),
      }
    })
}

/** A capsule's first four cells in garment order. */
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
      return { key, kind: 'photo', url: garment.imageAccess.url }
    })
}

/** The state line's text (D2): missing pieces, Needs review, or the saved date. */
export function useLooksTileStateText(): (state: LooksTileState) => string {
  const { t, i18n } = useTranslation()
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
  const { i18n } = useTranslation()
  const samples = getGuestPreviewStrings(i18n.language)
  return (look) =>
    look.title || sampleLookText({ id: look.lookId }, samples).name || look.lookId
}

function Cell({ cell }: { cell: LooksTileCell | null }) {
  const { colors } = useTokens()
  // P8: a failed photo swaps to the placeholder inside the same square, so nothing moves. The
  // failure belongs to that URL, so a refreshed signed URL for the piece shows again (Codex #7).
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const beforeExpiry = usePhotoBeforeExpiry(
    cell?.kind === 'photo' ? cell.expiresAt : undefined
  )
  const box = [styles.cell, { backgroundColor: colors.cardMuted }]
  if (!cell) return <View style={box} />
  if (cell.kind === 'photo' && beforeExpiry && failedUrl !== cell.url) {
    const PieceImage = cell.ephemeral ? ExpoImage : Image
    return (
      <View style={box}>
        <PieceImage
          source={{ uri: cell.url }}
          {...(cell.ephemeral
            ? { cachePolicy: 'none' as const, recyclingKey: cell.url }
            : {})}
          accessible={false}
          style={styles.photo}
          onError={() => setFailedUrl(cell.url)}
        />
      </View>
    )
  }
  if (cell.kind === 'art') {
    return (
      <View style={[box, styles.center]}>
        <SampleGarmentArt garment={cell.garment} size={CELL_ART_SIZE} />
      </View>
    )
  }
  return (
    // TEA M1: the dashed border sits on an absolute-fill child, so the cell keeps its flex share
    // and a failed photo moves nothing.
    <View testID="looks-tile-placeholder" style={box}>
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.placeholder,
          { borderColor: colors.lineStrong },
        ]}
      />
    </View>
  )
}

/**
 * The collage fills one square whatever the piece count: one piece fills it, two sit side by
 * side, three put the first beside a stacked pair, four make a 2 x 2 grid. No empty cells.
 * Decorative: the tile's label names the look.
 */
function Collage({ cells }: { cells: readonly LooksTileCell[] }) {
  const { colors, radius } = useTokens()
  const shown = cells.slice(0, 4)
  const cell = (index: number) => (
    <Cell key={shown[index]?.key ?? `empty-${index}`} cell={shown[index] ?? null} />
  )
  let body
  if (shown.length <= 1) body = cell(0)
  else if (shown.length === 2)
    body = (
      <View style={styles.collageRow}>
        {cell(0)}
        {cell(1)}
      </View>
    )
  else if (shown.length === 3)
    body = (
      <View style={styles.collageRow}>
        {cell(0)}
        <View style={styles.collageColumn}>
          {cell(1)}
          {cell(2)}
        </View>
      </View>
    )
  else
    body = [0, 2].map((row) => (
      <View key={row} style={styles.collageRow}>
        {cell(row)}
        {cell(row + 1)}
      </View>
    ))
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      // react-native-web reads aria-hidden; the native props above cover iOS and Android.
      aria-hidden
      style={[styles.collage, { borderRadius: radius.md, backgroundColor: colors.line }]}
    >
      {body}
    </View>
  )
}

function TileText({ name, line }: { name: string; line: string }) {
  const { colors, space, type, fontWeight } = useTokens()
  return (
    <View style={{ marginTop: space[2] }}>
      <Text
        numberOfLines={1}
        style={{
          color: colors.ink,
          fontSize: type.sm.fontSize,
          lineHeight: type.sm.lineHeight,
          fontWeight: fontWeight.semibold,
        }}
      >
        {name}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          color: colors.inkMuted,
          fontSize: type.xs.fontSize,
          lineHeight: type.xs.lineHeight,
        }}
      >
        {line}
      </Text>
    </View>
  )
}

/** A link tile (saved look or capsule). Its accessible name is the name and the state line (P8). */
function LooksLinkTile({
  testID,
  name,
  state,
  cells,
  onPress,
}: {
  testID: string
  name: string
  state: LooksTileState
  cells: readonly LooksTileCell[]
  onPress: () => void
}) {
  const { shell, space, radius } = useTokens()
  const stateText = useLooksTileStateText()
  const line = stateText(state)
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={`${name}, ${line}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          minHeight: shell.touchTarget,
          padding: space[1],
          borderRadius: radius.lg,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Collage cells={cells} />
      <TileText name={name} line={line} />
    </Pressable>
  )
}

export function SavedLookTile({
  look,
  onPress,
}: {
  look: SavedLookContract
  onPress: () => void
}) {
  const name = useSavedLookName()
  return (
    <LooksLinkTile
      testID={`saved-look-card-${look.id}`}
      name={name(look)}
      state={savedLookTileState(look)}
      cells={savedLookCells(look)}
      onPress={onPress}
    />
  )
}

export function CapsuleTile({
  capsule,
  onPress,
}: {
  capsule: OutfitCapsuleContract
  onPress: () => void
}) {
  return (
    <LooksLinkTile
      testID={`looks-capsule-card-${capsule.id}`}
      name={capsule.name}
      state={capsuleTileState(capsule)}
      cells={capsuleCells(capsule)}
      onPress={onPress}
    />
  )
}

/** D9: an Ideas tile, a picture with the look's name and its one-line description. No control. */
export function IdeaTile({ idea }: { idea: LooksIdea }) {
  const { i18n } = useTranslation()
  const { space } = useTokens()
  const samples = getGuestPreviewStrings(i18n.language)
  const text = sampleLookText(idea.look, samples)
  const cells: LooksTileCell[] = idea.garments
    .slice(0, 4)
    .map((garment) => ({ key: garment.id, kind: 'art', garment }))
  return (
    <View
      testID={`looks-idea-card-${idea.look.id}`}
      style={[styles.tile, { padding: space[1] }]}
    >
      <Collage cells={cells} />
      <TileText name={text.name} line={text.description} />
    </View>
  )
}

/** The two-column tile grid: rows of two, an odd last tile keeps its column width. */
export function LooksTileGrid({
  children,
  testID,
}: {
  children: ReactNode
  testID?: string
}) {
  const { space } = useTokens()
  const tiles = Children.toArray(children)
  const rows: ReactNode[][] = []
  for (let index = 0; index < tiles.length; index += 2)
    rows.push(tiles.slice(index, index + 2))
  return (
    <View testID={testID} style={{ gap: space[3] }}>
      {rows.map((row, index) => (
        <View key={index} style={[styles.gridRow, { gap: space[3] }]}>
          {row}
          {row.length === 1 ? <View style={styles.tile} /> : null}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0 },
  gridRow: { flexDirection: 'row' },
  collage: { aspectRatio: 1, gap: 2, overflow: 'hidden' },
  collageRow: { flex: 1, flexDirection: 'row', gap: 2 },
  collageColumn: { flex: 1, gap: 2 },
  cell: { flex: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
  placeholder: { borderWidth: 1, borderStyle: 'dashed' },
})
