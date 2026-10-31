// Learning path Step 48: Safe branded share-card export.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-48-safe-branded-share-card-export
import { describe, expect, it, vi } from 'vitest'
import { shareCardsClient } from '../src/share-cards-client'
import { preparedShareCardFixture as card } from '../src/testing/share-card-fixture'
const input = {
  source: { kind: 'outfit', recommendationId: 'owned' },
  locale: 'en-US',
  watermark: true,
  purpose: 'preview',
} as const
describe('deadline-aware share-card client', () => {
  it('validates contract input/output around the generated operation', async () => {
    const prepareShareCard = vi.fn(() => Promise.resolve({ data: card }))
    const client = shareCardsClient({ prepareShareCard })
    expect(await client.prepare(input)).toEqual(card)
    expect(prepareShareCard).toHaveBeenCalledWith(
      { prepareShareCardRequest: input },
      { signal: expect.any(AbortSignal) as AbortSignal }
    )
  })
  it('U-CANCEL: late response after cancellation cannot become a preview', async () => {
    const abort = new AbortController()
    const client = shareCardsClient({
      prepareShareCard: () => {
        abort.abort()
        return Promise.resolve({ data: card })
      },
    })
    await expect(client.prepare(input, abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
