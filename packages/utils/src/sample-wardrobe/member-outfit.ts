import { SAMPLE_CATALOG } from './catalog'
import {
  DEFAULT_SAMPLE_COMFORT,
  nextSampleLook,
  selectSampleOutfit,
  type SampleSelectionInput,
} from './selector'
import type { SampleGarmentCategory } from './types'

export function createMemberSampleOutfit() {
  const input: SampleSelectionInput = {
    weather: 'mild-dry',
    collection: 'all',
    comfort: DEFAULT_SAMPLE_COMFORT,
    votes: {},
    swaps: {},
  }
  return selectSampleOutfit(input, SAMPLE_CATALOG)
}

export function rotateMemberSampleOutfit(
  result: ReturnType<typeof createMemberSampleOutfit>
) {
  const next = nextSampleLook(result)
  return 'lookId' in next
    ? selectSampleOutfit({ ...result.input, selectedLookId: next.lookId }, SAMPLE_CATALOG)
    : result
}

export function swapMemberSampleGarment(
  result: ReturnType<typeof createMemberSampleOutfit>,
  category: SampleGarmentCategory,
  garmentId: string
) {
  const lookId = result.look?.id
  if (!lookId) return result
  return selectSampleOutfit(
    {
      ...result.input,
      swaps: {
        ...result.input.swaps,
        [lookId]: { ...result.input.swaps[lookId], [category]: garmentId },
      },
    },
    SAMPLE_CATALOG
  )
}

export function undoMemberSampleSwaps(
  result: ReturnType<typeof createMemberSampleOutfit>
) {
  const lookId = result.look?.id
  if (!lookId) return result
  const swaps = { ...result.input.swaps }
  delete swaps[lookId]
  return selectSampleOutfit({ ...result.input, swaps }, SAMPLE_CATALOG)
}
