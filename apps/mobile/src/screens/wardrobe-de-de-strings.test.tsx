// Story CC-7.9 D9 owner (7.9-NAT-005): the native Wardrobe hub and capsules screens render every
// member-facing string from the de-DE catalog, with no en-US source string left on screen.
// Learning path Step 66: One app shell and visual system.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-66-one-app-shell-and-visual-system
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 (TEA): the Closet's Add and More moved into its top bar and setup and Silhouette
// into the More sheet (D4, D5), so the hub renders under its tab top bar (TabTopBar) here and
// the sheet is opened for its de-DE copy too.
import React from 'react'
import type * as ReactNativeModule from 'react-native'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import type {
  GarmentItemContract,
  OutfitCapsuleContract,
} from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'de-DE', languageCode: 'de', regionCode: 'DE' }],
}))

vi.mock('expo-router', async () => ({
  router: { replace: vi.fn(), push: vi.fn(), setParams: vi.fn(), navigate: vi.fn() },
  Stack: { Screen: () => null },
  // Story CC-7.12 D6: the capsule manager reads its `capsule` focus param; none here.
  useLocalSearchParams: () => ({}),
  useFocusEffect: (await import('../test-utils/focus-effect.js')).useFocusEffect,
  useNavigation: (await import('../test-utils/tab-navigation-store.js')).useTabNavigation,
}))
// AppTopBar and the More sheet's X import the icon font, whose native module the browser lacks.
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: () => null }))

vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}))

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { PNG: 'png' },
}))

// The Style this piece entry keeps its cache on disk; nothing is cached in these cases.
vi.mock('expo-file-system', () => ({
  Directory: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    list() {
      return []
    }
  },
  File: class {
    uri: string
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}/${name}` : uri
    }
    readonly exists = false
    readonly size = 0
    textSync() {
      return ''
    }
    write = vi.fn()
    delete = vi.fn()
    bytes() {
      return Promise.resolve(new Uint8Array())
    }
  },
  Paths: { cache: 'file:///cache/', document: 'file:///documents' },
}))

vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => 'idem-key-1'),
}))

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  return {
    ...actual,
    findNodeHandle: vi.fn(),
    Alert: { alert: vi.fn() },
    Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
      visible ? children : null,
  }
})

import deDE from '../../assets/locales/de-DE.json'
import enUS from '../../assets/locales/en-US.json'
import i18n, { initI18n } from '@/src/lib/i18n'
import { server } from '@/src/test-utils/msw/server'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { WardrobeHubScreen } from '@/src/features/wardrobe/wardrobe-hub-screen'
import { press } from '@/src/test-utils/press'
import { TabTopBar, tabNavigation } from '@/src/test-utils/tab-navigation'
import WardrobeCapsulesScreen from '../../app/wardrobe-capsules'

/** Built at runtime so the fixture never looks like a credential to secret scanners. */
function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

const ACCESS_TOKEN = fakeAccessToken('auth-principal-user-1')

function garment(overrides: Partial<GarmentItemContract>): GarmentItemContract {
  return {
    id: 'garment-1',
    status: 'ready',
    category: 'top',
    material: 'cotton',
    comfortRange: 'mild',
    tagsConfirmedAt: '2026-08-05T10:00:00.000Z',
    fileSizeBytes: 1024,
    mimeType: 'image/png',
    retentionStatus: 'active',
    createdAt: '2026-08-05T10:00:00.000Z',
    committedAt: '2026-08-05T10:00:00.000Z',
    imageAccess: null,
    ...overrides,
  } as GarmentItemContract
}

const GARMENTS = [
  garment({ id: 'g-1', category: 'top' }),
  garment({ id: 'g-2', category: 'bottom', comfortRange: 'cool' }),
  garment({
    id: 'g-3',
    status: 'awaiting_tags',
    category: null,
    material: null,
    comfortRange: null,
    tagsConfirmedAt: null,
  }),
]

/** A capsule that lost a piece, so the repair copy renders; seven exist, one is shown. */
const CAPSULE = {
  id: 'cap-1',
  ownerUserId: 'user-1',
  name: 'Bürokapsel',
  description: 'Wochentage',
  occasions: ['work'],
  isFavorite: false,
  revision: 3,
  availabilityStatus: 'needs_repair',
  unavailableGarmentCount: 1,
  garments: [
    // The full contract shape: the capsule list response is schema-checked.
    {
      id: 'g-1',
      category: 'top',
      material: 'cotton',
      comfortRange: 'mild',
      imageAccess: null,
      availabilityStatus: 'ready',
      garmentOrder: 0,
    },
    {
      id: 'g-2',
      category: 'bottom',
      material: 'denim',
      comfortRange: 'mild',
      imageAccess: null,
      availabilityStatus: 'ready',
      garmentOrder: 1,
    },
  ],
  createdAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z',
} as unknown as OutfitCapsuleContract

type Tree = Record<string, unknown>

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (typeof value !== 'object' || value === null) return out
  for (const [key, child] of Object.entries(value as Tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'object' && child !== null) {
      for (const [nested, nestedValue] of flatten(child, path))
        out.set(nested, nestedValue)
    } else {
      out.set(path, String(child))
    }
  }
  return out
}

/**
 * Every en-US wardrobe, common and shell string that de-DE spells differently. Templates are
 * left out (their filled forms are asserted by value), and so are words of three letters or
 * fewer, which a German word may legitimately contain.
 */
function englishOnlyStrings(): string[] {
  const english = new Map<string, string>()
  const german = new Map<string, string>()
  for (const section of ['wardrobe', 'common', 'shell'] as const) {
    for (const [key, value] of flatten((enUS as Tree)[section], section))
      english.set(key, value)
    for (const [key, value] of flatten((deDE as Tree)[section], section))
      german.set(key, value)
  }
  return [...english]
    .filter(([key, value]) => german.get(key) !== value)
    .map(([, value]) => value.trim())
    .filter((value) => !value.includes('{{') && value.length > 3)
}

/** Each text node and each accessible name or placeholder the member can meet. */
function renderedStrings(root: HTMLElement): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim()
    if (text) out.push(text)
  }
  for (const element of Array.from(
    root.querySelectorAll('[aria-label], [placeholder]')
  )) {
    for (const name of ['aria-label', 'placeholder']) {
      const value = element.getAttribute(name)?.trim()
      if (value) out.push(value)
    }
  }
  return out
}

/** The rendered strings that are an en-US source string, or carry a whole English sentence. */
function englishLeftOnScreen(): string[] {
  const english = englishOnlyStrings()
  const sentences = english.filter((value) => value.includes(' ') && value.length >= 16)
  return renderedStrings(document.body).filter(
    (text) =>
      english.includes(text) || sentences.some((sentence) => text.includes(sentence))
  )
}

describe('7.9-NAT-005 native Wardrobe strings under de-DE', () => {
  let restoreAccessTokenResolver: () => void

  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('de-DE')
  })

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreAccessTokenResolver = setMobileAccessTokenResolver(() => ACCESS_TOKEN)
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: GARMENTS })),
      http.get('*/api/v1/wardrobe/onboarding', () =>
        HttpResponse.json({
          data: {
            status: 'in_progress',
            currentStep: 'capture',
            usedStarterWardrobe: false,
            garmentsCapturedCount: 0,
            startedAt: '2026-08-09T00:00:00.000Z',
            completedAt: null,
            revision: 1,
          },
        })
      ),
      http.get('*/api/v1/user/profile', () =>
        HttpResponse.json({
          user: {
            id: 'user-1',
            email: 'user-1@synthetic.test',
            displayName: null,
            birthdate: '1990-01-01T00:00:00.000Z',
            role: 'guardian',
          },
          linkedGuardians: [],
          linkedTeens: [],
        })
      ),
      http.get('*/api/v1/wardrobe/:ownerUserId/capsules', () =>
        HttpResponse.json({ data: [CAPSULE], total: 7, limit: 20, offset: 0 })
      )
    )
  })

  afterEach(() => {
    restoreAccessTokenResolver()
    setMobileApplicationUserId(null)
    tabNavigation.reset()
    vi.clearAllMocks()
  })

  it('[P1] [7.11 D4, D5] the Closet, its top bar and its More sheet render de-DE copy and no en-US source string', async () => {
    render(
      <>
        <TabTopBar title={deDE.tabs.closet} route="wardrobe" />
        <WardrobeHubScreen pollOffsetsMs={[1, 1, 1, 1]} />
      </>
    )

    await waitFor(() => expect(screen.getByTestId('wardrobe-garment-list')).toBeVisible())
    // The top bar's Add reads the short "+ Hinzufügen" with the full name for assistive tech.
    const add = screen.getByTestId('garment-capture-open')
    expect(add).toHaveTextContent(`+ ${deDE.wardrobe.menu.add}`)
    expect(add).toHaveAccessibleName(deDE.wardrobe.add_garment)
    const more = screen.getByTestId('closet-more-menu')
    expect(more).toHaveTextContent(deDE.wardrobe.menu.more)
    expect(screen.getByTestId('garment-status-awaiting_tags')).toHaveTextContent(
      deDE.wardrobe.hub.status.awaiting_tags
    )
    expect(screen.getAllByTestId(/^garment-open-/)[0]).toBeVisible()
    expect(screen.queryByTestId('garment-status-ready')).toBeNull()
    expect(englishLeftOnScreen()).toEqual([])

    press(more)
    const sheet = await screen.findByTestId('closet-more-sheet')
    expect(sheet).toHaveTextContent(deDE.wardrobe.menu.label)
    expect(screen.getByTestId('closet-more-setup')).toHaveTextContent(
      deDE.wardrobe.menu.setup
    )
    expect(screen.getByTestId('closet-more-silhouette')).toHaveTextContent(
      deDE.wardrobe.menu.silhouette
    )
    expect(screen.getByTestId('closet-more-close')).toHaveAccessibleName(
      deDE.wardrobe.menu.close
    )
    expect(englishLeftOnScreen()).toEqual([])
  })

  it('[P1] the capsules screen and its builder render de-DE copy and no en-US source string', async () => {
    setMobileApplicationUserId('user-1')
    render(<WardrobeCapsulesScreen />)

    await waitFor(() => expect(screen.getByTestId('capsule-card-cap-1')).toBeVisible())
    await waitFor(() =>
      expect(screen.getByText('2 Kleidungsstücke · Muss repariert werden')).toBeVisible()
    )
    expect(screen.getByTestId('capsule-truncation-notice')).toHaveTextContent(
      '1 von 7 werden angezeigt. Verfeinere deine Suche, um den Rest zu sehen.'
    )
    expect(screen.getByTestId('capsule-search-input')).toHaveAttribute(
      'placeholder',
      deDE.wardrobe.capsules.searchPlaceholder
    )

    await waitFor(() =>
      expect(screen.getByTestId('create-capsule-button')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    )
    fireEvent.click(screen.getByTestId('create-capsule-button'))

    const container = await screen.findByTestId('mobile-capsule-builder-container')
    expect(container).toBeVisible()
    expect(screen.getByTestId('close-modal-button')).toHaveAttribute(
      'aria-label',
      deDE.wardrobe.capsules.closeBuilder
    )
    expect(screen.getByTestId('garment-checkbox-g-2')).toHaveAttribute(
      'aria-label',
      'Hose, Kühl'
    )
    expect(screen.getByTestId('garment-checkbox-g-3')).toHaveAttribute(
      'aria-label',
      'Kleidungsstück ohne Tags'
    )
    expect(screen.getByTestId('favorite-toggle')).toHaveTextContent(
      `☆ ${deDE.wardrobe.capsules.markFavorite}`
    )
    expect(screen.getByTestId('save-capsule-button')).toHaveTextContent(
      deDE.wardrobe.capsules.save
    )

    expect(englishLeftOnScreen()).toEqual([])
    // The filled templates: no English count, status or truncation sentence anywhere.
    expect(document.body.textContent).not.toMatch(
      /garments? ·|Needs repair|Showing \d+ of/
    )
  })
})
