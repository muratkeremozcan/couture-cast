// Story CC-7.2 AC1 (moved by CC-7.12, TEA T3): which saved looks reopen in Style this piece. A
// Style this piece look reopens on its anchor garment only while it is ready, the anchor is in
// the closet, and the editor would rebuild exactly the saved slots; any other look stays in its
// detail. Web has the same rule in apps/web/src/app/components/looks/saved-look-reopen.ts.
// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
import type {
  GarmentItemContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import {
  SAMPLE_CATALOG,
  savedLookToStylePieceRecipe,
  stylePieceAnchor,
  stylePieceLooks,
  visibleStylePieceLooks,
} from '@couture/utils'

function sortedSlots(look: SavedLookContract) {
  return [...look.composition].sort((a, b) => a.slotIndex - b.slotIndex)
}

function editorPreservesExactComposition(
  look: SavedLookContract,
  anchor: GarmentItemContract
): boolean {
  const selection = stylePieceAnchor(anchor)
  const recipe = savedLookToStylePieceRecipe(look)
  if (!selection || !recipe) return false
  const generated = visibleStylePieceLooks(
    stylePieceLooks(selection, recipe.weather, SAMPLE_CATALOG).looks,
    { [recipe.lookId]: recipe },
    { reopenedLookId: recipe.lookId }
  )
  const matched = generated.find((entry) => entry.recipe.lookId === recipe.lookId)
  if (!matched) return false
  const expectedSlots = [
    { kind: 'garment', category: selection.category, itemId: anchor.id },
    ...matched.companions.map((companion) => ({
      kind: 'catalog',
      category: companion.category,
      itemId: companion.id,
    })),
  ]
  const stored = sortedSlots(look)
  if (stored.length !== expectedSlots.length) return false
  return stored.every((slot, index) => {
    const expected = expectedSlots[index]
    return (
      expected !== undefined &&
      slot.slotIndex === index &&
      slot.kind === expected.kind &&
      slot.category === expected.category &&
      slot.itemId === expected.itemId
    )
  })
}

/** The anchor garment to reopen `look` on, or null when the look stays in its detail. */
export function reopenAnchorFor<G extends GarmentItemContract>(
  look: SavedLookContract,
  garments: readonly G[]
): G | null {
  if (look.source !== 'style_piece' || look.availabilityStatus !== 'ready') return null
  const anchor = garments.find((item) => item.id === look.anchorGarmentId)
  if (!anchor || !anchor.category || !anchor.comfortRange) return null
  return editorPreservesExactComposition(look, anchor) ? anchor : null
}
