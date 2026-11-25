// Story 7.5 test plan 7.5-NAT-003..005: the native garment detail route. It shows the photo and
// tags of a ready garment, saves tag edits through the CC-7.1 status bar (Saved with Undo, No
// changes, distinct failures), tells the hub to reload, and opens Style this piece.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
import React from 'react'
import { userEvent as browserUser } from 'vitest/browser'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const routerMock = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
  dismissTo: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  setParams: vi.fn(),
}))
vi.mock('expo-router', () => ({
  router: routerMock,
  // The stack header is native chrome; render its title and back control inline.
  Stack: {
    Screen: ({
      options,
    }: {
      options: { title?: string; headerLeft?: () => React.ReactNode }
    }) => (
      <div data-testid="stack-header">
        {options.headerLeft?.()}
        <span data-testid="stack-header-title">{options.title}</span>
      </div>
    ),
  },
}))

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('expo-file-system', () => ({
  Directory: class {
    uri: string
    constructor(uri: string) {
      this.uri = uri
    }
    list() {
      const prefix = `${this.uri}/`
      return Array.from(files.keys())
        .filter((uri) => uri.startsWith(prefix))
        .map((uri) => ({ uri, name: uri.slice(prefix.length) }))
    }
  },
  File: class {
    uri: string
    constructor(uri: string, name?: string) {
      this.uri = name ? `${uri}/${name}` : uri
    }
    get exists() {
      return files.has(this.uri)
    }
    get size() {
      return new TextEncoder().encode(files.get(this.uri) ?? '').length
    }
    textSync() {
      return files.get(this.uri) ?? ''
    }
    write(data: string) {
      files.set(this.uri, data)
    }
    delete() {
      files.delete(this.uri)
    }
  },
  Paths: { cache: 'file:///cache/', document: 'file:///documents' },
}))

vi.mock('expo-crypto', () => ({
  digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: vi.fn(() => 'idem-key-1'),
}))

import { createReadyGarmentFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import {
  reportNetworkOffline,
  reportNetworkOnline,
  SaveFeedbackProvider,
} from '@/components/save-feedback'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import { onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { createSavedLooksMswHandlers } from '@/src/test-utils/saved-looks-msw'
import { server } from '@/src/test-utils/msw/server'
import { GarmentDetailScreen } from './garment-detail-screen'

const owner = 'garment-detail-owner'
const garmentId = 'native-blue-top'

function fakeAccessToken(userId: string): string {
  const payload = btoa(JSON.stringify({ sub: userId })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

function photo(color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return { url: canvas.toDataURL('image/png'), expiresAt: '2099-12-31T00:00:00.000Z' }
}

const blueTop = {
  ...createReadyGarmentFixture({
    id: garmentId,
    category: 'top',
    material: 'cotton',
    comfortRange: 'mild',
    imageAccess: photo('#1e3cc8'),
  }),
  colorFamily: 'blue' as const,
}

let closet: Record<string, unknown>[]
let patches: { body: unknown; header: string | null }[]
let reply: (body: Record<string, unknown>) => Response | Promise<Response>
let changes: number
let stopWatching: () => void
let restoreToken: () => void

const loaded = { category: 'top', material: 'cotton', comfortRange: 'mild' }

/** Answers like the API: the request's tags win; `expected` is a request-only field. */
function acceptTags(body: Record<string, unknown>) {
  const tags = { ...body }
  delete tags.expected
  const current = closet.find((item) => item.id === garmentId)!
  const updated = { ...current, ...tags }
  closet = closet.map((item) => (item.id === garmentId ? updated : item))
  return HttpResponse.json({ data: updated })
}

function renderDetail(id: string | undefined = garmentId, withProvider = true) {
  const detail = <GarmentDetailScreen garmentId={id} />
  render(withProvider ? <SaveFeedbackProvider>{detail}</SaveFeedbackProvider> : detail)
}

const tag = (testId: string) => screen.getByTestId(testId)

/** The visible group and choice names a member hears for each tag option. */
const TAG_CHOICES: Record<string, readonly [group: string, choice: string]> = {
  'garment-tag-option-category-outerwear': ['Category', 'Outer layer'],
  'garment-tag-option-material-wool': ['Material', 'Wool'],
  'garment-tag-option-material-cotton': ['Material', 'Cotton'],
  'garment-tag-option-material-none': ['Material', 'No material'],
  'garment-tag-option-comfort-cold': ['Comfort range', 'Cold'],
}

const editTagsButton = () => screen.findByRole('button', { name: 'Edit tags' })

/** Opens the editor and picks options the way a screen reader user names them. */
async function openEditorAndPick(...testIds: string[]) {
  await browserUser.click(await editTagsButton())
  for (const testId of testIds) {
    const [group, choice] = TAG_CHOICES[testId]!
    const option = within(screen.getByRole('radiogroup', { name: group })).getByRole(
      'radio',
      { name: choice }
    )
    expect(option).toHaveAttribute('data-testid', testId)
    await browserUser.click(option)
  }
}

describe('GarmentDetailScreen', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = window.location.origin
    restoreToken = setMobileAccessTokenResolver(() => fakeAccessToken(owner))
    setMobileApplicationUserId(owner)
    reportNetworkOnline()
    closet = [blueTop]
    patches = []
    reply = acceptTags
    changes = 0
    stopWatching = onWardrobeChanged(() => {
      changes++
    })
    const { handlers: savedLooks } = createSavedLooksMswHandlers()
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => HttpResponse.json({ data: closet })),
      http.patch(`*/api/v1/wardrobe/garments/${garmentId}/tags`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        patches.push({ body, header: request.headers.get('x-couture-garment-color') })
        return reply(body)
      }),
      ...savedLooks
    )
  })

  afterEach(() => {
    stopWatching()
    restoreToken()
    setMobileApplicationUserId(null)
    reportNetworkOnline()
    files.clear()
    vi.clearAllMocks()
  })

  it('[P0] [7.5-NAT-003] shows back, the labeled photo, the tags, Edit tags and Style this piece', async () => {
    renderDetail()

    const detail = await screen.findByTestId('garment-detail')
    expect(screen.getByTestId('stack-header-title')).toHaveTextContent('Blue top')
    expect(within(detail).getByTestId('garment-detail-photo')).toHaveAccessibleName(
      'Blue top'
    )
    expect(tag('garment-detail-category').textContent).toBe('Top')
    expect(tag('garment-detail-material').textContent).toBe('Cotton')
    expect(tag('garment-detail-comfort').textContent).toBe('Mild')
    expect(await editTagsButton()).toHaveAttribute('data-testid', 'garment-edit-tags')
    expect(tag('style-piece-open')).toBeVisible()

    await browserUser.click(tag('garment-detail-back'))
    expect(routerMock.back).toHaveBeenCalledTimes(1)
  })

  it('[P1] [7.5-NAT-003] back with no history returns to the closet tab', async () => {
    routerMock.canGoBack.mockReturnValueOnce(false)
    renderDetail()

    await browserUser.click(await screen.findByTestId('garment-detail-back'))

    expect(routerMock.dismissTo).toHaveBeenCalledWith('/wardrobe')
    expect(routerMock.back).not.toHaveBeenCalled()
  })

  it.each([
    ['an id that left the closet', 'gone-piece', [blueTop]],
    [
      'a garment that is no longer ready',
      garmentId,
      [{ ...blueTop, status: 'processing' }],
    ],
  ])(
    '[P1] [7.5-NAT-003] %s shows "no longer in your closet"',
    async (_case, id, data) => {
      closet = data
      renderDetail(id)

      expect(await screen.findByTestId('garment-detail-missing')).toHaveTextContent(
        'This piece is no longer in your closet.'
      )
      expect(tag('garment-detail-back')).toBeVisible()
    }
  )

  it('[P0] [7.5-NAT-004] saves changed tags, shows the answer, offers Undo and tells the hub', async () => {
    renderDetail()
    await openEditorAndPick(
      'garment-tag-option-material-wool',
      'garment-tag-option-comfort-cold'
    )

    await browserUser.click(tag('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
    expect(tag('status-bar-action-undo')).toHaveTextContent('Undo')
    expect(patches).toEqual([
      {
        // Codex P2.1: Done names the tags it loaded.
        body: {
          category: 'top',
          material: 'wool',
          comfortRange: 'cold',
          expected: loaded,
        },
        header: '1',
      },
    ])
    expect(tag('garment-detail-material').textContent).toBe('Wool')
    expect(tag('garment-detail-comfort').textContent).toBe('Cold')
    expect(screen.queryByTestId('garment-tag-editor')).toBeNull()
    expect(changes).toBe(1)
  })

  it('[P0] [7.5-NAT-004] Undo sends the previous tags back', async () => {
    renderDetail()
    await openEditorAndPick('garment-tag-option-category-outerwear')
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() =>
      expect(tag('stack-header-title')).toHaveTextContent('Blue outer layer')
    )

    await browserUser.click(await screen.findByTestId('status-bar-action-undo'))

    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent('Change undone.')
    )
    const savedTags = { category: 'outerwear', material: 'cotton', comfortRange: 'mild' }
    expect(patches.map(({ body }) => body)).toEqual([
      { ...savedTags, expected: loaded },
      { ...loaded, expected: savedTags },
    ])
    expect(tag('garment-detail-category').textContent).toBe('Top')
    expect(tag('stack-header-title')).toHaveTextContent('Blue top')
    expect(changes).toBe(2)
  })

  it('[P0] [7.5-NAT-004] Done without a change says "No changes" and sends nothing', async () => {
    renderDetail()
    await openEditorAndPick(
      'garment-tag-option-material-wool',
      'garment-tag-option-material-cotton'
    )

    await browserUser.click(tag('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent(
      'No changes'
    )
    expect(patches).toEqual([])
    expect(changes).toBe(0)
  })

  it.each([['GARMENT_TAGS_CHANGED'], ['CONCURRENT_TAG_UPDATE']])(
    '[P1] [7.5-NAT-005] a %s conflict says so, closes the editor and reads the piece again',
    async (message) => {
      let reads = 0
      server.use(
        http.get('*/api/v1/wardrobe/garments', () => {
          reads += 1
          return HttpResponse.json({ data: closet })
        })
      )
      reply = () =>
        HttpResponse.json(
          { statusCode: 409, message, error: 'Conflict' },
          { status: 409 }
        )
      renderDetail()
      await openEditorAndPick('garment-tag-option-material-wool')
      const readsBefore = reads

      await browserUser.click(tag('garment-tag-done'))

      expect(await screen.findByTestId('garment-tag-error')).toHaveTextContent(
        'This piece changed on another device. Check the tags and try again.'
      )
      expect(screen.queryByTestId('garment-tag-editor')).toBeNull()
      await waitFor(() => expect(reads).toBe(readsBefore + 1))
      expect(tag('garment-detail-material').textContent).toBe('Cotton')

      // Opening the editor again starts clean.
      await browserUser.click(await editTagsButton())
      expect(screen.queryByTestId('garment-tag-error')).toBeNull()
    }
  )

  it.each([
    [
      'a guardian block',
      403,
      'GUARDIAN_CONSENT_REQUIRED',
      'A guardian has to approve closet changes first.',
    ],
    ['a server failure', 500, 'Internal server error', 'Could not save. Try again.'],
  ])(
    '[P1] [7.5-NAT-005] names %s in its own words and keeps the draft',
    async (_case, status, message, copy) => {
      reply = () => HttpResponse.json({ statusCode: status, message }, { status })
      renderDetail()
      await openEditorAndPick('garment-tag-option-material-wool')

      await browserUser.click(tag('garment-tag-done'))

      expect(await screen.findByTestId('garment-tag-error')).toHaveTextContent(copy)
      expect(tag('garment-tag-option-material-wool')).toHaveAttribute(
        'aria-checked',
        'true'
      )
      expect(tag('garment-detail-material').textContent).toBe('Cotton')
      expect(changes).toBe(0)
    }
  )

  it('[P1] [7.5-NAT-005] offline Done sends nothing and keeps the draft', async () => {
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    act(() => reportNetworkOffline())

    await browserUser.click(tag('garment-tag-done'))

    expect(await screen.findByTestId('garment-tag-error')).toHaveTextContent(
      'You are offline. Save when you reconnect.'
    )
    expect(patches).toEqual([])
    expect(tag('garment-tag-option-material-wool')).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('[P1] [7.5-NAT-004] material clears to null and the editor offers singular categories', async () => {
    renderDetail()
    await browserUser.click(await editTagsButton())
    expect(tag('garment-tag-option-category-top').textContent).toBe('Top')
    expect(tag('garment-tag-option-category-dress').textContent).toBe('Dress')
    expect(screen.queryByTestId('garment-tag-option-category-none')).toBeNull()

    await browserUser.click(tag('garment-tag-option-material-none'))
    await browserUser.click(tag('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
    expect(patches[0]?.body).toEqual({
      category: 'top',
      material: null,
      comfortRange: 'mild',
      expected: loaded,
    })
    expect(tag('garment-detail-material').textContent).toBe('No material')
  })

  it('[P1] [7.5-NAT-003] Style this piece opens the panel for this garment', async () => {
    renderDetail()

    await browserUser.click(await screen.findByTestId('style-piece-open'))

    const panel = await screen.findByTestId('style-piece-panel')
    expect(await within(panel).findAllByTestId('style-piece-look')).toHaveLength(3)
  })

  it('[P2] [7.5-NAT-004] shows Saved inline without a status bar provider', async () => {
    renderDetail(garmentId, false)
    await openEditorAndPick('garment-tag-option-material-wool')

    await browserUser.click(tag('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
  })

  it('[P0] [7.5-NAT-007] a newer Done retires the older Undo (Codex P2.1)', async () => {
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    await browserUser.click(tag('garment-tag-done'))
    await screen.findByTestId('status-bar-action-undo')
    await openEditorAndPick('garment-tag-option-comfort-cold')
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(patches).toHaveLength(2))

    await browserUser.click(await screen.findByTestId('status-bar-action-undo'))

    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent('Change undone.')
    )
    const firstSave = { category: 'top', material: 'wool', comfortRange: 'mild' }
    const secondSave = { ...firstSave, comfortRange: 'cold' }
    expect(patches.map(({ body }) => body)).toEqual([
      { ...firstSave, expected: loaded },
      { ...secondSave, expected: firstSave },
      { ...firstSave, expected: secondSave },
    ])
    expect(tag('garment-detail-comfort').textContent).toBe('Mild')
  })

  it('[P1] [7.5-NAT-007] an Undo refused because the piece changed elsewhere says so without Retry', async () => {
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    await browserUser.click(tag('garment-tag-done'))
    // The save settles before the next reply is set, so only the Undo meets it.
    await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
    reply = () =>
      HttpResponse.json(
        { statusCode: 409, message: 'GARMENT_TAGS_CHANGED', error: 'Conflict' },
        { status: 409 }
      )

    await browserUser.click(await screen.findByTestId('status-bar-action-undo'))

    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent(
        'This piece changed on another device. Check the tags and try again.'
      )
    )
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(tag('garment-detail-material').textContent).toBe('Wool')
  })

  it('[P1] [7.5-NAT-008] a slow save reads Saving, then Still saving, then Saved (Codex P2.3)', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    reply = async (body) => {
      await held
      return acceptTags(body)
    }
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')

    await browserUser.click(tag('garment-tag-done'))

    await waitFor(() => expect(tag('garment-tag-done')).toHaveTextContent('Saving'))
    await waitFor(
      () => expect(tag('garment-tag-done')).toHaveTextContent('Still saving'),
      {
        timeout: 3000,
      }
    )
    release()
    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
  })

  it('[P1] [7.5-NAT-009] renews a photo whose signed link is about to expire (Codex P2.5)', async () => {
    let reads = 0
    const expiring = {
      ...blueTop,
      imageAccess: {
        url: blueTop.imageAccess!.url,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
    }
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        reads += 1
        return HttpResponse.json({ data: reads === 1 ? [expiring] : [blueTop] })
      })
    )
    renderDetail()

    await screen.findByTestId('garment-detail')
    await waitFor(() => expect(reads).toBe(2))
    expect(tag('garment-detail-photo')).toHaveAccessibleName('Blue top')
  })

  it('[P1] [7.5-NAT-012] the editor compares and sends the tags it opened with, even if the piece reloads meanwhile', async () => {
    // An expiring photo lease makes the detail read the closet again as it opens; that read is
    // held until the editor is open, then brings another device's material.
    const expiring = {
      ...blueTop,
      imageAccess: {
        ...blueTop.imageAccess!,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
    }
    const held = Promise.withResolvers<void>()
    const reloadStarted = Promise.withResolvers<void>()
    let reads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        reads += 1
        if (reads === 1) return HttpResponse.json({ data: [expiring] })
        reloadStarted.resolve()
        await held.promise
        return HttpResponse.json({ data: [{ ...blueTop, material: 'linen' }] })
      })
    )
    renderDetail()
    await reloadStarted.promise
    await browserUser.click(await editTagsButton())

    held.resolve()
    await waitFor(() => expect(tag('garment-detail-material').textContent).toBe('Linen'))
    const cold = within(
      screen.getByRole('radiogroup', { name: 'Comfort range' })
    ).getByRole('radio', { name: 'Cold' })
    await browserUser.click(cold)
    await browserUser.click(tag('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
    expect(patches.map(({ body }) => body)).toEqual([
      { category: 'top', material: 'cotton', comfortRange: 'cold', expected: loaded },
    ])
  })

  it('[P1] [7.5-NAT-012] a saved answer without a signed photo keeps the photo already shown', async () => {
    reply = (body) => {
      const tags = { ...body }
      delete tags.expected
      return HttpResponse.json({ data: { ...blueTop, ...tags, imageAccess: null } })
    }
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')

    await browserUser.click(tag('garment-tag-done'))

    expect(await screen.findByTestId('status-feedback-bar')).toHaveTextContent('Saved')
    expect(tag('garment-detail-material').textContent).toBe('Wool')
    expect(tag('garment-detail-photo').querySelector('img')).toHaveAttribute(
      'src',
      blueTop.imageAccess!.url
    )
  })
})
