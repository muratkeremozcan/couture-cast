// Story CC-7.12 D2, D9 owner: the native Looks picture tile. A 2 x 2 collage of a look's first
// four pieces, then its name and one state line. Saved looks and capsules are one link each;
// Ideas tiles are pictures with no control until CC-7.22 ships the lookbook.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import { Children, useState, type ReactNode } from 'react'
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
import { SampleGarmentArt } from '../preview/guest-preview-parts'

const CATALOG_BY_ID = new Map(SAMPLE_CATALOG.garments.map((item) => [item.id, item]))

/** The catalog art's drawing size inside a collage cell. */
const CELL_ART_SIZE = 44

/** One collage cell: a member photo, catalog art or the dashed placeholder. */
export type LooksTileCell =
  | { readonly key: string; readonly kind: 'photo'; readonly url: string }
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
      return { key, kind: 'photo', url: slot.imageAccess.url }
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
  // P8: a failed photo swaps to the placeholder inside the same square, so nothing moves.
  const [failed, setFailed] = useState(false)
  const box = [styles.cell, { backgroundColor: colors.cardMuted }]
  if (!cell) return <View style={box} />
  if (cell.kind === 'photo' && !failed) {
    return (
      <View style={box}>
        <Image
          source={{ uri: cell.url }}
          accessible={false}
          style={styles.photo}
          onError={() => setFailed(true)}
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
    <View
      testID="looks-tile-placeholder"
      style={[box, styles.placeholder, { borderColor: colors.lineStrong }]}
    />
  )
}

/** The 2 x 2 collage. Decorative: the tile's label names the look. */
function Collage({ cells }: { cells: readonly LooksTileCell[] }) {
  const { colors, radius } = useTokens()
  const at = (index: number) => cells[index] ?? null
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.collage, { borderRadius: radius.md, backgroundColor: colors.line }]}
    >
      {[0, 2].map((row) => (
        <View key={row} style={styles.collageRow}>
          <Cell key={at(row)?.key ?? `empty-${row}`} cell={at(row)} />
          <Cell key={at(row + 1)?.key ?? `empty-${row + 1}`} cell={at(row + 1)} />
        </View>
      ))}
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
  cell: { flex: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
  placeholder: { borderWidth: 1, borderStyle: 'dashed' },
})
