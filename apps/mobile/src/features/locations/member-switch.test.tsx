// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up after the project close (2026-11-19), Codex review 5 findings 1 and 2,
// mobile. The Locations screen belongs to one member at a time. When the phone's session moves
// from member A to member B (or signs out):
// - A's saved rows leave the screen, whether A's list had finished or was still loading, and B's
//   own list loads;
// - a save A started never writes A's place to B's account (switch before the request goes out),
//   and a save already sent as A changes nothing on B's screen when it answers.
import React from 'react'
import { userEvent } from 'vitest/browser'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type * as Locations from '@/src/lib/locations'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))
const router = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
  push: vi.fn(),
}))
vi.mock('expo-router', () => ({ router }))
vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  PermissionStatus: {
    GRANTED: 'granted',
    DENIED: 'denied',
    UNDETERMINED: 'undetermined',
  },
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}))

/** The list and save calls, kept until they settle, so a test waits for late answers. */
const tracked = vi.hoisted(() => ({ promises: [] as Promise<unknown>[] }))

vi.mock('@/src/lib/locations', async (importOriginal) => {
  const actual = await importOriginal<typeof Locations>()
  const track =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    (...args: A) => {
      const pending = call(...args)
      tracked.promises.push(pending)
      return pending
    }
  return {
    ...actual,
    listLocationsFromMobile: track(actual.listLocationsFromMobile),
    saveLocationFromSearchFromMobile: track(actual.saveLocationFromSearchFromMobile),
  }
})

import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { AccessibilityAnnouncerProvider } from '@/src/hooks/use-accessibility-announcer'
import { locationCandidate, savedLocation } from '@/src/test-utils/locations'
import { LocationsScreen } from './locations-screen'

const A_HOME = savedLocation({ id: 'a-1', label: 'Alpha Home' })
const B_OFFICE = savedLocation({
  id: 'b-1',
  label: 'Bravo Office',
  city: 'Springfield',
  region: 'Missouri',
  locationKey: 'springfield-key',
})
const SPRINGFIELD = locationCandidate({
  city: 'Springfield',
  region: 'Missouri',
  displayLabel: 'Springfield, Missouri, United States',
  candidateToken: 'springfield-payload.signature',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function renderScreen(guided = false) {
  render(
    <AccessibilityAnnouncerProvider>
      <LocationsScreen guided={guided} />
    </AccessibilityAnnouncerProvider>
  )
}

/**
 * Every tracked list and save has settled (including any they started) and React has applied
 * what their handlers set.
 */
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await Promise.allSettled(tracked.promises)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe(
  'the Locations screen belongs to one member at a time (mobile)',
  { timeout: 30_000 },
  () => {
    let bearer: string | undefined
    let holdNextToken: boolean
    let heldToken: { resolve: (token: string | undefined) => void } | null
    let listBearers: (string | null)[]
    let saveBearers: (string | null)[]
    let holdAList: { promise: Promise<void>; resolve: () => void } | null
    let restoreAccessTokenResolver: () => void
    const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL

    beforeAll(async () => {
      await initI18n()
      await i18n.changeLanguage('en-US')
    })

    beforeEach(() => {
      bearer = 'token-a'
      holdNextToken = false
      heldToken = null
      listBearers = []
      saveBearers = []
      holdAList = null
      tracked.promises = []
      router.back.mockClear()
      process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
      setMobileApplicationUserId('member-a')
      restoreAccessTokenResolver = setMobileAccessTokenResolver(() => {
        if (!holdNextToken) return bearer
        holdNextToken = false
        const token = deferred<string | undefined>()
        heldToken = token
        return token.promise
      })
      server.use(
        http.get('*/api/v1/locations', async ({ request }) => {
          const authorization = request.headers.get('authorization')
          listBearers.push(authorization)
          if (authorization === 'Bearer token-b')
            return HttpResponse.json({ data: [B_OFFICE] })
          if (holdAList) await holdAList.promise
          return HttpResponse.json({ data: [A_HOME] })
        }),
        http.get('*/api/v1/locations/search', () =>
          HttpResponse.json({ data: [SPRINGFIELD] })
        )
      )
    })

    afterEach(() => {
      if (originalBaseUrl === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL
      else process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl
      restoreAccessTokenResolver()
      setMobileApplicationUserId(null)
    })

    function switchTo(member: 'member-b' | null) {
      act(() => {
        bearer = member === 'member-b' ? 'token-b' : undefined
        setMobileApplicationUserId(member)
      })
    }

    const noAlpha = () => expect(screen.queryByText(/Alpha/)).toBeNull()

    it('LOC-MEMBER-MOB-01 A rows that had loaded leave the screen, and B list loads', async () => {
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()

      switchTo('member-b')

      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      noAlpha()
      expect(listBearers).toEqual(['Bearer token-a', 'Bearer token-b'])
    })

    it('LOC-MEMBER-MOB-02 A rows leave the screen on sign-out', async () => {
      renderScreen()
      expect(await screen.findByText('Alpha Home')).toBeTruthy()

      switchTo(null)
      await settle()

      noAlpha()
      expect(screen.queryByTestId('location-item-0')).toBeNull()
    })

    it('LOC-MEMBER-MOB-03 an A list still loading at the switch never fills B screen', async () => {
      holdAList = deferred<void>()
      renderScreen()
      await waitFor(() => expect(listBearers).toEqual(['Bearer token-a']))

      switchTo('member-b')
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      act(() => holdAList!.resolve())
      await settle()

      expect(screen.getByText('Bravo Office')).toBeTruthy()
      noAlpha()
    })

    /** A picks Springfield and names it, ready to save. */
    async function prepareSave() {
      renderScreen(true)
      expect(await screen.findByText('Alpha Home')).toBeTruthy()
      await userEvent.fill(await screen.findByTestId('locations-search-input'), 'Spring')
      await userEvent.click(await screen.findByTestId('location-search-option-0'))
      const label = await screen.findByTestId('location-label-input')
      await userEvent.fill(label, 'Alpha Studio')
    }

    it('LOC-MEMBER-MOB-04 a save waiting for its bearer at the switch writes nothing to B account', async () => {
      server.use(
        http.post('*/api/v1/locations/from-search', ({ request }) => {
          saveBearers.push(request.headers.get('authorization'))
          return HttpResponse.json(
            { data: savedLocation({ label: 'Alpha Studio' }) },
            { status: 201 }
          )
        })
      )
      await prepareSave()

      holdNextToken = true
      await userEvent.click(screen.getByTestId('location-save-button'))
      await waitFor(() => expect(heldToken).not.toBeNull())
      switchTo('member-b')
      await act(async () => {
        heldToken!.resolve('token-b')
        await Promise.resolve()
      })
      await settle()

      expect(saveBearers).toEqual([])
      expect(router.back).not.toHaveBeenCalled()
      noAlpha()
    })

    it('LOC-MEMBER-MOB-05 a save already sent as A changes nothing on B screen when it answers', async () => {
      const answer = deferred<void>()
      server.use(
        http.post('*/api/v1/locations/from-search', async ({ request }) => {
          saveBearers.push(request.headers.get('authorization'))
          await answer.promise
          return HttpResponse.json(
            { data: savedLocation({ label: 'Alpha Studio' }) },
            { status: 201 }
          )
        })
      )
      await prepareSave()

      await userEvent.click(screen.getByTestId('location-save-button'))
      await waitFor(() => expect(saveBearers).toEqual(['Bearer token-a']))
      switchTo('member-b')
      expect(await screen.findByText('Bravo Office')).toBeTruthy()
      const search = await screen.findByTestId('locations-search-input')
      await userEvent.fill(search, 'Bra')
      const listsBefore = [...listBearers]

      act(() => answer.resolve())
      await settle()

      expect(router.back).not.toHaveBeenCalled()
      expect(screen.getByTestId('locations-search-input')).toHaveValue('Bra')
      expect(listBearers).toEqual(listsBefore)
      noAlpha()
    })
  }
)
