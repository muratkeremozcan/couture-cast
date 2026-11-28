// Learning path Step 80: AI-written look ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { createMemberLookbook, createStyleProfileStore } from '@couture/utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { useMobileStyleProfile } from '@/src/lib/style-profile'
import { initI18n } from '@/src/lib/i18n'
import {
  mobileApplicationUserId,
  mobileIdentityEpoch,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import type * as MobileApi from '@/src/lib/api-client'
import type * as RecipeStorage from '@/src/lib/sample-recipe-storage'
import type * as PreviewParts from '../preview/guest-preview-parts'
import { MemberLookbook } from './member-lookbook'

const MEMBER = 'fixture-member-a'
const SECOND_MEMBER = 'fixture-member-b'
let restoreToken: (() => void) | undefined
const network = vi.hoisted(() => ({
  forecast: vi.fn(),
  generate: vi.fn(),
}))

vi.mock('expo-router', async () => ({
  router: { push: vi.fn() },
  useFocusEffect: (await import('../../test-utils/focus-effect.js')).useFocusEffect,
}))
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
vi.mock('@/src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof MobileApi>()),
  createMobileApiClient: () => ({
    apiV1RitualGet: network.forecast,
    apiV1PersonalizationLookIdeasPost: network.generate,
  }),
}))
vi.mock('@/src/lib/sample-recipe-storage', async (importOriginal) => ({
  ...(await importOriginal<typeof RecipeStorage>()),
  sampleRecipeStorage: () =>
    Promise.resolve({ read: () => null, write: vi.fn(), remove: vi.fn() }),
}))
vi.mock('@/components/save-feedback', () => ({ SaveActionButton: () => null }))
vi.mock('../preview/style-profile-controls', () => ({ StyleDayControls: () => null }))
vi.mock('../preview/guest-preview-parts', async (importOriginal) => ({
  ...(await importOriginal<typeof PreviewParts>()),
  SampleGarmentArt: () => null,
}))

const DEFAULT = createMemberLookbook('mild-dry')
const descriptions = [
  'A polished mix for the day.',
  'A sporty mix for the day.',
  'A cozy mix for the day.',
]
const ranking = {
  data: DEFAULT.map(({ result }, index) => ({
    lookId: result.look!.id,
    description: descriptions[index]!,
  })).reverse(),
}
const otherRanking = {
  data: ranking.data.map(({ lookId }) => ({
    lookId,
    description: 'A simple mix for the day.',
  })),
}
const store = createStyleProfileStore(mobileApplicationUserId, () =>
  Promise.resolve({ mood: null, palette: null, texture: null, fit: null, avoid: [] })
)

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, failed) => {
    resolve = done
    reject = failed
  })
  return { promise, resolve, reject }
}

function editor() {
  const owner = mobileApplicationUserId()!
  const epoch = mobileIdentityEpoch()
  const style: ReturnType<typeof useMobileStyleProfile> = {
    scope: owner,
    status: 'ready',
    profile: null,
    day: null,
    saving: false,
    store,
  }
  return <MemberLookbook key={epoch} owner={owner} epoch={epoch} style={style} />
}

const initialMood = () => screen.getByTestId(`lookbook-mood-${DEFAULT[0]!.mood}`)
const promotedMood = () => screen.getByTestId(`lookbook-mood-${DEFAULT.at(-1)!.mood}`)
const pin = () => screen.getByTestId('lookbook-pin-shoes')
const description = () => screen.queryByTestId('lookbook-ai-description')
const newIdeas = () => screen.queryByTestId('lookbook-new-ideas')
const pieceNames = () =>
  within(screen.getByTestId('looks-idea-card-current'))
    .getAllByTestId(/^lookbook-piece-/)
    .map((piece) => piece.textContent)

beforeAll(async () => {
  await initI18n()
})

beforeEach(() => {
  restoreToken = setMobileAccessTokenResolver(() => 'fixture-token')
  setMobileApplicationUserId(MEMBER)
  network.forecast.mockReset().mockRejectedValue(new Error('Forecast unavailable'))
  network.generate.mockReset().mockResolvedValue({ data: null })
})

afterEach(() => {
  restoreToken?.()
  setMobileApplicationUserId(null)
})

describe('CC-7.23 native look ideas', () => {
  it('shows the default look while pending, then applies the top-ranked idea', async () => {
    const response = deferred<typeof ranking>()
    network.generate.mockReturnValueOnce(response.promise)
    render(editor())
    await screen.findByTestId('member-lookbook')
    await waitFor(() => expect(network.generate).toHaveBeenCalledTimes(1))
    expect(initialMood()).toHaveAttribute('aria-pressed', 'true')
    expect(description()).toBeNull()

    await act(async () => {
      response.resolve(ranking)
      await response.promise
    })

    expect(initialMood()).toHaveAttribute('aria-pressed', 'false')
    expect(promotedMood()).toHaveAttribute('aria-pressed', 'true')
    expect(description()).toHaveTextContent(descriptions.at(-1))
    expect(newIdeas()).toBeNull()
  })

  it('preserves the edited composition and pin until and after New ideas ready', async () => {
    const response = deferred<typeof ranking>()
    network.generate.mockReturnValueOnce(response.promise)
    render(editor())
    await screen.findByTestId('member-lookbook')
    await waitFor(() => expect(network.generate).toHaveBeenCalledTimes(1))

    await userEvent.click(pin())
    const original = pieceNames()
    await userEvent.click(screen.getByTestId('lookbook-shuffle'))
    const edited = pieceNames()
    expect(edited).not.toEqual(original)
    await act(async () => {
      response.resolve(ranking)
      await response.promise
    })
    expect(newIdeas()).toBeVisible()
    expect(description()).toBeNull()
    expect(initialMood()).toHaveAttribute('aria-pressed', 'true')
    expect(pin()).toHaveAttribute('aria-pressed', 'true')
    expect(pieceNames()).toEqual(edited)

    await userEvent.click(screen.getByTestId('lookbook-new-ideas'))
    expect(description()).toHaveTextContent(descriptions[0])
    expect(newIdeas()).toBeNull()
    expect(initialMood()).toHaveAttribute('aria-pressed', 'true')
    expect(pin()).toHaveAttribute('aria-pressed', 'true')
    expect(pieceNames()).toEqual(edited)
  })

  it.each(['another session', 'another account'])(
    'drops a late response after opening %s',
    async (change) => {
      const older = deferred<typeof ranking>()
      const newer = deferred<typeof ranking>()
      network.generate
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise)
      const { rerender } = render(editor())
      await waitFor(() => expect(network.generate).toHaveBeenCalledTimes(1))

      act(() => {
        setMobileApplicationUserId(null)
        setMobileApplicationUserId(change === 'another account' ? SECOND_MEMBER : MEMBER)
      })
      rerender(editor())
      await waitFor(() => expect(network.generate).toHaveBeenCalledTimes(2))
      await act(async () => {
        newer.resolve(otherRanking)
        await newer.promise
      })
      expect(description()).toHaveTextContent(otherRanking.data[0]!.description)

      await act(async () => {
        older.resolve(ranking)
        await older.promise
      })
      expect(description()).toHaveTextContent(otherRanking.data[0]!.description)
      expect(promotedMood()).toHaveAttribute('aria-pressed', 'true')
      expect(newIdeas()).toBeNull()
    }
  )

  it('keeps the rule-based look usable when generation fails', async () => {
    const response = deferred<typeof ranking>()
    network.generate.mockReturnValueOnce(response.promise)
    render(editor())
    await screen.findByTestId('member-lookbook')
    await waitFor(() => expect(network.generate).toHaveBeenCalledTimes(1))
    const original = pieceNames()

    await act(async () => {
      response.reject(new Error('Generation unavailable'))
      await response.promise.catch(() => undefined)
    })

    expect(description()).toBeNull()
    expect(newIdeas()).toBeNull()
    expect(initialMood()).toHaveAttribute('aria-pressed', 'true')
    expect(pieceNames()).toEqual(original)
    await userEvent.click(pin())
    expect(pin()).toHaveAttribute('aria-pressed', 'true')
  })
})
