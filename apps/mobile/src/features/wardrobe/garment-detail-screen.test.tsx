// Story 7.5 test plan 7.5-NAT-003..005: the native garment detail route. It shows the photo and
// tags of a ready garment, saves tag edits through the CC-7.1 status bar (Saved with Undo, No
// changes, distinct failures), tells the hub to reload, and opens Style this piece.
// Learning path Step 63: Garment detail and tag edit.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-63-garment-detail-and-tag-edit
// Story 7.6 test plan 7.6-NAT-002..003: Delete on the detail reads where the piece is used,
// asks only for a piece in a look, and returns to the hub.
// Learning path Step 64: Garment delete.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
import React from 'react'
import { userEvent as browserUser } from 'vitest/browser'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  // The stack header is native chrome (Story CC-7.9 D6: the shared AppTopBar, whose back control
  // is covered in app-top-bar.test.tsx); render the title the screen hands it inline.
  Stack: {
    Screen: ({ options }: { options: { title?: string } }) => (
      <div data-testid="stack-header">
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

// Every tag save and closet read the detail starts, so a test can await the client answer it
// is checking.
const client = vi.hoisted(() => ({
  saves: [] as Promise<unknown>[],
  reads: [] as Promise<unknown>[],
}))
vi.mock('@/src/lib/wardrobe', async (importOriginal) => {
  const actual = await importOriginal<typeof MobileWardrobe>()
  return {
    ...actual,
    updateGarmentTagsFromMobile: (
      ...args: Parameters<typeof actual.updateGarmentTagsFromMobile>
    ) => {
      const call = actual.updateGarmentTagsFromMobile(...args)
      client.saves.push(call)
      return call
    },
    listGarmentsFromMobile: (
      ...args: Parameters<typeof actual.listGarmentsFromMobile>
    ) => {
      const call = actual.listGarmentsFromMobile(...args)
      client.reads.push(call)
      return call
    },
  }
})
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
  useStatusBar,
} from '@/components/save-feedback'
import i18n, { initI18n } from '@/src/lib/i18n'
import {
  mobileIdentityEpoch,
  setMobileAccessTokenResolver,
  setMobileApplicationUserId,
} from '@/src/lib/mobile-auth'
import type * as MobileWardrobe from '@/src/lib/wardrobe'
import { onWardrobeChanged } from '@/src/lib/wardrobe-changes'
import { createSavedLooksMswHandlers } from '@/src/test-utils/saved-looks-msw'
import { server } from '@/src/test-utils/msw/server'
import {
  createDeferredGarmentDeletion,
  SAVE_FEEDBACK_TIMINGS,
  type DeferredGarmentDeletionEvent,
  type DeferredGarmentDeletionTimer,
} from '@couture/utils'
import {
  createMobileGarmentDeletion,
  resetGarmentDeletionForTests,
  type MobileGarmentDeletion,
} from './garment-deletion'
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

/** Picks one option in the open editor the way a screen reader user names it. */
async function openEditorChoice(testId: string) {
  const [group, choice] = TAG_CHOICES[testId]!
  await browserUser.click(
    within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', {
      name: choice,
    })
  )
}

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

/**
 * A manual timer for the deletion controller. `advance` runs the live timers due by then one at a
 * time, earliest first (ties in the order they were set): it moves the clock to each timer's due
 * time before running it, so a timer a callback clears never runs and one it sets is due from
 * that moment. The same implementation lives in the hub and detail suites.
 */
function createManualTimer() {
  let now = 0
  let nextHandle = 1
  const scheduled = new Map<number, { at: number; callback: () => void }>()
  const timer: DeferredGarmentDeletionTimer = {
    setTimeout: (callback, ms) => {
      const handle = nextHandle++
      scheduled.set(handle, { at: now + ms, callback })
      return handle
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle as number)
    },
  }
  const nextDue = (until: number) =>
    [...scheduled.entries()]
      .filter(([, entry]) => entry.at <= until)
      .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
  const advance = (ms: number) => {
    const until = now + ms
    for (let due = nextDue(until); due; due = nextDue(until)) {
      const [handle, entry] = due
      scheduled.delete(handle)
      now = entry.at
      entry.callback()
    }
    now = until
  }
  return { timer, advance, active: () => scheduled.size, now: () => now }
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
    client.saves = []
    client.reads = []
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

  it('[P0] [7.5-NAT-003] [7.9 D6] titles the header, shows the labeled photo, the tags, Edit tags and Style this piece', async () => {
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
    // The header owns the title; the body repeats it in no heading of its own.
    expect(within(detail).queryByRole('heading', { name: 'Blue top' })).toBeNull()
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
      // The stack header (title and back) stays registered on the missing state.
      expect(tag('stack-header')).toBeInTheDocument()
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
    '[P1] [7.5-NAT-005] a %s conflict says so, keeps the draft and retries against the re-read tags',
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
      await openEditorAndPick(
        'garment-tag-option-material-wool',
        'garment-tag-option-comfort-cold'
      )
      const readsBefore = reads
      // Another device stored linen while this editor was open on cotton.
      closet = [{ ...blueTop, material: 'linen' }]

      await browserUser.click(tag('garment-tag-done'))

      expect(await screen.findByTestId('garment-tag-error')).toHaveTextContent(
        'This piece changed on another device. Check the tags and try again.'
      )
      // The draft stays open; the closet re-reads the piece once and the rows show what it found.
      expect(tag('garment-tag-editor')).toBeVisible()
      expect(tag('garment-tag-option-material-wool')).toHaveAttribute(
        'aria-checked',
        'true'
      )
      expect(tag('garment-tag-option-comfort-cold')).toHaveAttribute(
        'aria-checked',
        'true'
      )
      await waitFor(() => expect(reads).toBe(readsBefore + 1))
      await waitFor(() =>
        expect(tag('garment-detail-material').textContent).toBe('Linen')
      )

      // Done again is a deliberate retry against the tags the re-read found.
      reply = acceptTags
      await browserUser.click(tag('garment-tag-done'))
      await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
      expect(patches.map(({ body }) => body)).toEqual([
        { category: 'top', material: 'wool', comfortRange: 'cold', expected: loaded },
        {
          category: 'top',
          material: 'wool',
          comfortRange: 'cold',
          expected: { ...loaded, material: 'linen' },
        },
      ])
      expect(tag('garment-detail-material').textContent).toBe('Wool')
    }
  )

  it('[P1] [7.5-NAT-005] after a conflict, Done waits for the re-read, even for a draft back on the old tags', async () => {
    let releaseRead!: () => void
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let conflicted = false
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        if (conflicted) await readHeld
        return HttpResponse.json({ data: closet })
      })
    )
    reply = () => {
      conflicted = true
      return HttpResponse.json(
        { statusCode: 409, message: 'GARMENT_TAGS_CHANGED', error: 'Conflict' },
        { status: 409 }
      )
    }
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    closet = [{ ...blueTop, material: 'linen' }]

    await browserUser.click(tag('garment-tag-done'))
    await screen.findByTestId('garment-tag-error')
    // The member puts the draft back on the tags the editor opened with before the read lands.
    await openEditorChoice('garment-tag-option-material-cotton')
    await waitFor(() =>
      expect(tag('garment-tag-done')).toHaveAttribute('aria-disabled', 'true')
    )

    // A press while the read is pending does nothing: no request and no "No changes".
    act(() => {
      fireEvent.click(tag('garment-tag-done'))
    })
    expect(patches).toHaveLength(1)
    // The bar may have dismissed the conflict notice by now, so look for the words anywhere.
    expect(screen.queryByText('No changes')).toBeNull()

    const pendingRead = client.reads.at(-1)!
    await act(async () => {
      releaseRead()
      await pendingRead
    })
    await waitFor(() => expect(tag('garment-detail-material').textContent).toBe('Linen'))
    await waitFor(() =>
      expect(tag('garment-tag-done')).not.toHaveAttribute('aria-disabled', 'true')
    )

    reply = acceptTags
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
    expect(patches[1]!.body).toEqual({
      ...loaded,
      expected: { ...loaded, material: 'linen' },
    })
  })

  it('[P1] [7.5-NAT-005] a failed re-read after a conflict offers Retry, which reads the closet again', async () => {
    let conflicted = false
    let failedOnce = false
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        if (conflicted && !failedOnce) {
          failedOnce = true
          return HttpResponse.json({ message: 'unavailable' }, { status: 503 })
        }
        return HttpResponse.json({ data: closet })
      })
    )
    reply = () => {
      conflicted = true
      return HttpResponse.json(
        { statusCode: 409, message: 'GARMENT_TAGS_CHANGED', error: 'Conflict' },
        { status: 409 }
      )
    }
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    closet = [{ ...blueTop, material: 'linen' }]

    await browserUser.click(tag('garment-tag-done'))
    const retry = await screen.findByTestId('garment-tag-reread')
    expect(retry).toHaveTextContent('Retry')
    expect(tag('garment-tag-done')).toHaveAttribute('aria-disabled', 'true')
    expect(tag('garment-detail-material').textContent).toBe('Cotton')
    const readsBefore = client.reads.length

    await browserUser.click(retry)
    await waitFor(() => expect(tag('garment-detail-material').textContent).toBe('Linen'))
    expect(client.reads).toHaveLength(readsBefore + 1)
    expect(screen.queryByTestId('garment-tag-reread')).toBeNull()
    expect(tag('garment-tag-option-material-wool')).toHaveAttribute(
      'aria-checked',
      'true'
    )

    reply = acceptTags
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
    expect(patches[1]!.body).toEqual({
      ...loaded,
      material: 'wool',
      expected: { ...loaded, material: 'linen' },
    })
  })

  it('[P1] [7.5-NAT-005] after a conflict, a draft that matches the re-read tags says No changes', async () => {
    reply = () =>
      HttpResponse.json(
        { statusCode: 409, message: 'GARMENT_TAGS_CHANGED', error: 'Conflict' },
        { status: 409 }
      )
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    closet = [{ ...blueTop, material: 'wool' }]

    await browserUser.click(tag('garment-tag-done'))
    await screen.findByTestId('garment-tag-error')
    await waitFor(() => expect(tag('garment-detail-material').textContent).toBe('Wool'))

    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent('No changes')
    )
    expect(patches).toHaveLength(1)
  })

  it('[P2] [7.5-NAT-005] closing the editor after a conflict reopens it from the stored tags', async () => {
    reply = () =>
      HttpResponse.json(
        { statusCode: 409, message: 'GARMENT_TAGS_CHANGED', error: 'Conflict' },
        { status: 409 }
      )
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    closet = [{ ...blueTop, material: 'linen' }]

    await browserUser.click(tag('garment-tag-done'))
    await screen.findByTestId('garment-tag-error')
    await waitFor(() => expect(tag('garment-detail-material').textContent).toBe('Linen'))
    await browserUser.click(tag('garment-tag-cancel'))

    await browserUser.click(await editTagsButton())
    expect(screen.queryByTestId('garment-tag-error')).toBeNull()
    expect(tag('garment-tag-option-material-linen')).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

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

  it('[P0] [7.5-NAT-007] an Undo answer that lands after a newer Done committed leaves that Done in place', async () => {
    let releaseUndo!: () => void
    const undoHeld = new Promise<void>((resolve) => {
      releaseUndo = resolve
    })
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
    // The Undo (back to cotton) is held and answers without touching the stored closet; every
    // other save answers at once.
    reply = async (body) => {
      if (body.material !== 'cotton') return acceptTags(body)
      await undoHeld
      return HttpResponse.json({ data: blueTop })
    }

    await browserUser.click(tag('status-bar-action-undo'))
    await waitFor(() => expect(patches).toHaveLength(2))
    const undoCall = client.saves[1]!
    await openEditorAndPick('garment-tag-option-comfort-cold')
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(patches).toHaveLength(3))
    await waitFor(() => expect(tag('garment-detail-comfort').textContent).toBe('Cold'))

    // The detail handles the Undo answer before this await resumes, and act flushes what it set.
    await act(async () => {
      releaseUndo()
      await undoCall
    })

    // The stale Undo answer (cotton, mild) never replaces the newer Done's garment.
    expect(tag('garment-detail-material').textContent).toBe('Wool')
    expect(tag('garment-detail-comfort').textContent).toBe('Cold')
    expect(tag('status-feedback-bar')).not.toHaveTextContent('Change undone.')
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
    // Settle every read started so far, so only reads the conflict starts are counted.
    await act(async () => {
      await Promise.allSettled(client.reads)
    })
    const readsBefore = client.reads.length

    await browserUser.click(await screen.findByTestId('status-bar-action-undo'))

    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent(
        'This piece changed on another device. Check the tags and try again.'
      )
    )
    expect(screen.queryByTestId('status-bar-action-retry')).toBeNull()
    expect(tag('garment-detail-material').textContent).toBe('Wool')
    // The closet reads the piece again once, so the rows show what is stored now. Once that
    // read has landed and its updates are flushed, no further read has started.
    await waitFor(() => expect(client.reads).toHaveLength(readsBefore + 1))
    await act(async () => {
      await Promise.allSettled(client.reads)
    })
    expect(client.reads).toHaveLength(readsBefore + 1)
  })

  it('[P1] [7.5-NAT-013] an account change drops the detail notice and its Undo', async () => {
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
    expect(tag('status-bar-action-undo')).toBeVisible()

    act(() => setMobileApplicationUserId('another-member'))

    await waitFor(() => expect(screen.queryByTestId('status-bar-action-undo')).toBeNull())
    // No visible Saved remains. The outer provider's live region keeps the text it already
    // spoke, since the detail forwards announcements to it; that is not a notice on screen.
    const visibleSaved = screen
      .queryAllByText('Saved')
      .filter((node) => !node.closest('[data-testid="save-feedback-announcer"]'))
    expect(visibleSaved).toEqual([])
    expect(patches).toHaveLength(1)
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
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let markReloadStarted!: () => void
    const reloadStarted = new Promise<void>((resolve) => {
      markReloadStarted = resolve
    })
    let reads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', async () => {
        reads += 1
        if (reads === 1) return HttpResponse.json({ data: [expiring] })
        markReloadStarted()
        await held
        return HttpResponse.json({ data: [{ ...blueTop, material: 'linen' }] })
      })
    )
    renderDetail()
    await reloadStarted
    await browserUser.click(await editTagsButton())

    release()
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

  it("[P0] [7.5-NAT-013] shows Saved from the pushed detail's own bar, not the root provider (Android Maestro, 72b7cd7b)", async () => {
    // The root provider's floating bar never showed over the pushed stack screen on Android:
    // the save landed but the member saw no Saved and no Undo. The detail owns its bar.
    function RootNotice() {
      const { notice } = useStatusBar()
      return <span data-testid="root-notice">{notice?.message ?? ''}</span>
    }
    render(
      <SaveFeedbackProvider>
        <GarmentDetailScreen garmentId={garmentId} />
        <RootNotice />
      </SaveFeedbackProvider>
    )
    await openEditorAndPick('garment-tag-option-material-wool')

    await browserUser.click(tag('garment-tag-done'))

    const bar = await screen.findByTestId('status-feedback-bar')
    expect(bar).toHaveTextContent('Saved')
    expect(within(bar).getByTestId('status-bar-action-undo')).toBeVisible()
    expect(screen.getAllByTestId('status-feedback-bar')).toHaveLength(1)
    // The root provider holds no notice: the bar shown belongs to the detail screen.
    expect(screen.getByTestId('root-notice').textContent).toBe('')
  })

  it('[P1] [7.5-NAT-014] a failed closet read offers Try again, which loads the piece', async () => {
    let reads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        reads += 1
        return reads === 1
          ? HttpResponse.json({ message: 'unavailable' }, { status: 503 })
          : HttpResponse.json({ data: closet })
      })
    )
    renderDetail()

    expect(await screen.findByText('Could not load this piece. Try again.')).toBeVisible()
    expect(screen.queryByTestId('garment-detail-missing')).toBeNull()
    await browserUser.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('garment-detail')).toBeVisible()
    expect(reads).toBe(2)
  })

  it('[P1] [7.5-NAT-014] without a session the closet is not read and Try again is offered', async () => {
    let reads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        reads += 1
        return HttpResponse.json({ data: closet })
      })
    )
    const restoreSignedOut = setMobileAccessTokenResolver(() => undefined)
    renderDetail()

    expect(await screen.findByText('Could not load this piece. Try again.')).toBeVisible()
    expect(reads).toBe(0)

    restoreSignedOut()
    await browserUser.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('garment-detail')).toBeVisible()
    expect(reads).toBe(1)
  })

  it('[P1] [7.5-NAT-014] a piece without a signed photo shows a named placeholder', async () => {
    closet = [{ ...blueTop, imageAccess: null }]
    renderDetail()

    const photo = await screen.findByTestId('garment-detail-photo')
    expect(photo).toHaveAccessibleName('Blue top')
    expect(photo.querySelector('img')).toBeNull()
  })

  it('[P1] [7.5-NAT-014] Undo while offline says so, and its Retry undoes once back online', async () => {
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
    act(() => reportNetworkOffline())

    await browserUser.click(tag('status-bar-action-undo'))

    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    expect(patches).toHaveLength(1)
    act(() => reportNetworkOnline())
    await browserUser.click(tag('status-bar-action-retry'))

    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent('Change undone.')
    )
    expect(patches).toHaveLength(2)
    expect(tag('garment-detail-material').textContent).toBe('Cotton')
  })

  it('[P1] [7.5-NAT-014] a failed Undo keeps the saved tags and offers Retry', async () => {
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
    reply = () => HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 })

    await browserUser.click(tag('status-bar-action-undo'))

    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent('Could not undo. Try again.')
    )
    expect(tag('status-bar-action-retry')).toBeVisible()
    expect(tag('garment-detail-material').textContent).toBe('Wool')
  })

  it('[P1] [7.5-NAT-014] an Undo whose connection drops mid-request reads as offline and offers Retry', async () => {
    renderDetail()
    await openEditorAndPick('garment-tag-option-material-wool')
    await browserUser.click(tag('garment-tag-done'))
    await waitFor(() => expect(tag('status-feedback-bar')).toHaveTextContent('Saved'))
    // The device still reports online; the request itself fails at the network.
    reply = () => HttpResponse.error()

    await browserUser.click(tag('status-bar-action-undo'))

    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent(
        'You are offline. Save when you reconnect.'
      )
    )
    expect(patches).toHaveLength(2)
    expect(tag('status-bar-action-retry')).toBeVisible()
    expect(tag('garment-detail-material').textContent).toBe('Wool')

    reply = acceptTags
    await browserUser.click(tag('status-bar-action-retry'))
    await waitFor(() =>
      expect(tag('status-feedback-bar')).toHaveTextContent('Change undone.')
    )
    expect(tag('garment-detail-material').textContent).toBe('Cotton')
  })

  it('[P2] [7.5-NAT-014] renews an expiring photo lease once, even when the app returns to the foreground', async () => {
    const expiring = {
      ...blueTop,
      imageAccess: {
        url: blueTop.imageAccess!.url,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
    }
    let reads = 0
    server.use(
      http.get('*/api/v1/wardrobe/garments', () => {
        reads += 1
        return HttpResponse.json({ data: [expiring] })
      })
    )
    renderDetail()
    await screen.findByTestId('garment-detail')
    // The open renews the lease; the API hands back the same lease.
    await waitFor(() => expect(reads).toBe(2))

    // Back in the foreground the same lease is not renewed again.
    for (const visibility of ['hidden', 'visible'] as const) {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: visibility,
      })
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: visibility === 'hidden',
      })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(reads).toBe(2)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })
  // Story 7.6 test plan 7.6-NAT-002..003: Delete reads where the piece is used first. Unused:
  // no prompt, a deferred delete with an Undo window, back to the hub. Used: one in-screen
  // prompt with the count; accepting deletes at once. A 404 usage read means already gone; a
  // failed read deletes nothing and offers Retry.
  // Learning path Step 64: Garment delete.
  // See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-64-garment-delete
  describe('7.6 garment delete', () => {
    const windowMs = SAVE_FEEDBACK_TIMINGS.statusBarDurationMs
    const bearer = `Bearer ${fakeAccessToken(owner)}`
    const scheduled = { type: 'scheduled', id: garmentId } as const
    const committing = { type: 'committing', id: garmentId } as const
    const committed = { type: 'committed', id: garmentId } as const
    let usageReply: () => Response | Promise<Response>
    let usageReads: { id: string; authorization: string | null }[]
    let deletes: { id: string; authorization: string | null }[]
    let clock: ReturnType<typeof createManualTimer>
    let deletion: MobileGarmentDeletion
    let events: DeferredGarmentDeletionEvent[]

    const usedIn = (savedLookCount: number, capsuleCount: number) => () =>
      HttpResponse.json({ garmentId, savedLookCount, capsuleCount })

    function deletableDetail(id = garmentId) {
      return (
        <SaveFeedbackProvider>
          <GarmentDetailScreen garmentId={id} deletion={deletion} />
        </SaveFeedbackProvider>
      )
    }

    function renderDeletableDetail() {
      return render(deletableDetail())
    }

    const deleteButton = () => screen.findByRole('button', { name: 'Delete' })
    const USAGE_FAILED = 'Could not check where this piece is used. Try again.'
    /** The inline usage failure, with its Retry, inside the detail (D3). */
    const usageFailed = () => screen.findByTestId('garment-delete-usage-failed')
    const usageRetry = () => tag('garment-delete-usage-retry')

    beforeEach(() => {
      usageReads = []
      deletes = []
      usageReply = usedIn(0, 0)
      server.use(
        http.get('*/api/v1/wardrobe/garments/:garmentId/usage', ({ request, params }) => {
          usageReads.push({
            id: String(params.garmentId),
            authorization: request.headers.get('authorization'),
          })
          return usageReply()
        }),
        http.delete('*/api/v1/wardrobe/garments/:garmentId', ({ request, params }) => {
          deletes.push({
            id: String(params.garmentId),
            authorization: request.headers.get('authorization'),
          })
          return new HttpResponse(null, { status: 204 })
        })
      )
      clock = createManualTimer()
      deletion = createMobileGarmentDeletion(
        createDeferredGarmentDeletion({ timer: clock.timer })
      )
      events = []
      deletion.controller.subscribe((event) => {
        events.push(event)
      })
    })

    afterEach(() => {
      deletion.reset()
      deletion.dispose()
      resetGarmentDeletionForTests()
    })

    it('[P0] [7.6-NAT-002] Delete on an unused piece asks nothing, returns to the hub and sends one DELETE only when the window ends', async () => {
      renderDeletableDetail()
      const remove = await deleteButton()
      expect(remove).toHaveAttribute('data-testid', 'garment-delete')

      await browserUser.click(remove)

      await waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1))
      expect(routerMock.dismissTo).not.toHaveBeenCalled()
      expect(screen.queryByTestId('garment-delete-confirm')).toBeNull()
      expect(usageReads).toEqual([{ id: garmentId, authorization: bearer }])
      expect(deletion.pendingIds()).toEqual([garmentId])
      expect(events).toEqual([scheduled])

      act(() => clock.advance(windowMs - 1))
      expect(events).toEqual([scheduled])

      act(() => clock.advance(1))
      await waitFor(() => expect(events).toEqual([scheduled, committing, committed]))
      expect(deletes).toEqual([{ id: garmentId, authorization: bearer }])
      expect(deletion.pendingIds()).toEqual([])
    })

    it.each([
      ['one saved look', 1, 0, 'Delete this piece? It is in 1 look.'],
      ['two saved looks and a capsule', 2, 1, 'Delete this piece? It is in 3 looks.'],
    ])(
      '[P0] [7.6-NAT-003] a piece in %s asks first and names how many looks',
      async (_case, savedLookCount, capsuleCount, copy) => {
        usageReply = usedIn(savedLookCount, capsuleCount)
        renderDeletableDetail()

        await browserUser.click(await deleteButton())

        const confirm = await screen.findByTestId('garment-delete-confirm')
        expect(
          within(confirm).getByTestId('garment-delete-confirm-count').textContent
        ).toBe(copy)
        expect(
          within(confirm).getByRole('button', { name: 'Delete piece' })
        ).toHaveAttribute('data-testid', 'garment-delete-confirm-accept')
        expect(within(confirm).getByRole('button', { name: 'Keep it' })).toHaveAttribute(
          'data-testid',
          'garment-delete-cancel'
        )
        expect(routerMock.back).not.toHaveBeenCalled()
        expect(deletion.pendingIds()).toEqual([])
        expect(events).toEqual([])
      }
    )

    it('[P0] [7.6-NAT-003] Keep it sends nothing and leaves the detail open', async () => {
      usageReply = usedIn(1, 1)
      renderDeletableDetail()
      await browserUser.click(await deleteButton())

      await browserUser.click(await screen.findByRole('button', { name: 'Keep it' }))

      await waitFor(() =>
        expect(screen.queryByTestId('garment-delete-confirm')).toBeNull()
      )
      act(() => clock.advance(windowMs * 2))
      expect(tag('garment-detail')).toBeVisible()
      expect(tag('garment-delete')).not.toHaveAttribute('aria-disabled', 'true')
      expect(routerMock.back).not.toHaveBeenCalled()
      expect(usageReads).toHaveLength(1)
      expect(clock.active()).toBe(0)
      expect(events).toEqual([])
      expect(deletes).toEqual([])
    })

    it('[P0] [7.6-NAT-003] Delete piece deletes at once with no Undo window and returns to the hub', async () => {
      usageReply = usedIn(2, 0)
      renderDeletableDetail()
      await browserUser.click(await deleteButton())

      await browserUser.click(await screen.findByRole('button', { name: 'Delete piece' }))

      expect(routerMock.back).toHaveBeenCalledTimes(1)
      // No window was started: the send began on the tap.
      expect(clock.active()).toBe(0)
      await waitFor(() => expect(events).toEqual([committing, committed]))
      expect(deletes).toEqual([{ id: garmentId, authorization: bearer }])
      expect(usageReads).toHaveLength(1)
    })

    it('[P1] [7.6-NAT-003] a piece already gone (usage 404 GARMENT_NOT_FOUND) sends one idempotent DELETE at once and returns to the hub', async () => {
      usageReply = () =>
        HttpResponse.json(
          { statusCode: 404, message: 'GARMENT_NOT_FOUND', error: 'Not Found' },
          { status: 404 }
        )
      // The hub's side of the deletion: the hidden set, its grid update and the notices it
      // shows on the root status bar.
      let hiddenSetChanges = 0
      deletion.subscribe(() => {
        hiddenSetChanges++
      })
      const committedIds: string[] = []
      const shown: string[] = []
      const spoken: string[] = []
      deletion.attach({
        epoch: mobileIdentityEpoch(),
        presenter: {
          showNotice: (input) => {
            shown.push(input.message)
            return { id: input.id, durationMs: windowMs }
          },
          dismissNotice: () => undefined,
          announce: (message) => {
            spoken.push(message)
          },
          isOnline: () => true,
          t: (key) => i18n.t(key),
        },
        onCommitted: (id) => {
          committedIds.push(id)
        },
      })
      renderDeletableDetail()

      await browserUser.click(await deleteButton())

      await waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1))
      // No Undo window: the send began without any timer.
      expect(clock.active()).toBe(0)
      await waitFor(() => expect(events).toEqual([committing, committed]))
      expect(deletes).toEqual([{ id: garmentId, authorization: bearer }])
      // Hidden while it sends, then gone; the hub removes it and says Deleted with no Undo.
      expect(hiddenSetChanges).toBe(2)
      expect(committedIds).toEqual([garmentId])
      expect(shown).toEqual(['Deleted'])
      // No Retry was on the bar, so Deleted shows rather than being only announced.
      expect(spoken).toEqual([])
      expect(screen.queryByTestId('garment-delete-confirm')).toBeNull()
    })

    it('[P1] [7.6-NAT-003] a bare 404 usage answer (no GARMENT_NOT_FOUND) is a failed read: nothing is deleted and Retry is offered', async () => {
      // A deploy without the usage route answers the framework's own 404.
      usageReply = () =>
        HttpResponse.json(
          {
            statusCode: 404,
            message: `Cannot GET /api/v1/wardrobe/garments/${garmentId}/usage`,
            error: 'Not Found',
          },
          { status: 404 }
        )
      renderDeletableDetail()

      await browserUser.click(await deleteButton())

      // The failure stays inside this detail, bound to this piece; the status bar is free.
      const failure = await usageFailed()
      expect(failure).toHaveAttribute('role', 'alert')
      expect(failure.textContent).toBe(`${USAGE_FAILED}Retry`)
      expect(within(failure).getByRole('button', { name: 'Retry' })).toBe(usageRetry())
      expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
      expect(tag('garment-detail')).toBeVisible()
      expect(routerMock.back).not.toHaveBeenCalled()
      act(() => clock.advance(windowMs))
      expect(deletion.pendingIds()).toEqual([])
      expect(events).toEqual([])
      expect(deletes).toEqual([])
      // Delete itself stays usable from the failure, and so does Edit tags.
      expect(tag('garment-delete')).not.toHaveAttribute('aria-disabled', 'true')
      expect(tag('garment-edit-tags')).not.toHaveAttribute('aria-disabled', 'true')
      usageReply = usedIn(0, 0)

      await browserUser.click(await deleteButton())

      await waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1))
      expect(usageReads).toHaveLength(2)
      expect(events).toEqual([scheduled])
      expect(screen.queryByTestId('garment-delete-usage-failed')).toBeNull()
    })

    it('[P1] [7.6-NAT-003] a failed usage read deletes nothing, offers Retry, and Retry reads again', async () => {
      usageReply = () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Internal server error' },
          { status: 500 }
        )
      renderDeletableDetail()

      await browserUser.click(await deleteButton())

      expect((await usageFailed()).textContent).toBe(`${USAGE_FAILED}Retry`)
      expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
      expect(tag('garment-detail')).toBeVisible()
      expect(routerMock.back).not.toHaveBeenCalled()
      expect(deletion.pendingIds()).toEqual([])
      expect(events).toEqual([])
      expect(deletes).toEqual([])

      usageReply = usedIn(0, 0)
      await browserUser.click(usageRetry())

      await waitFor(() => expect(routerMock.back).toHaveBeenCalledTimes(1))
      expect(usageReads).toHaveLength(2)
      expect(events).toEqual([scheduled])
      expect(screen.queryByTestId('garment-delete-usage-failed')).toBeNull()
    })

    it('[P1] [7.6-NAT-003] the usage failure leaves when the detail shows another piece', async () => {
      const otherId = 'native-plain-shoes'
      closet = [
        blueTop,
        {
          ...createReadyGarmentFixture({
            id: otherId,
            category: 'shoes',
            material: 'leather',
            comfortRange: 'mild',
            imageAccess: photo('#222222'),
          }),
          colorFamily: null,
        },
      ]
      usageReply = () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Internal server error' },
          { status: 500 }
        )
      const view = renderDeletableDetail()
      await browserUser.click(await deleteButton())
      await usageFailed()

      view.rerender(deletableDetail(otherId))

      await waitFor(() =>
        expect(screen.queryByTestId('garment-delete-usage-failed')).toBeNull()
      )
      expect(tag('garment-detail')).toBeVisible()
      expect(tag('garment-delete')).not.toHaveAttribute('aria-disabled', 'true')
      expect(usageReads).toEqual([{ id: garmentId, authorization: bearer }])
      expect(screen.queryByTestId('status-feedback-bar')).toBeNull()
      expect(events).toEqual([])
      expect(deletes).toEqual([])
    })

    it('[P1] [7.6-NAT-003] Edit tags is disabled while the delete check and its prompt run, and comes back after Keep it', async () => {
      const usageAnswer = (() => {
        let open!: () => void
        const opened = new Promise<void>((resolve) => {
          open = resolve
        })
        return { opened, open }
      })()
      usageReply = async () => {
        await usageAnswer.opened
        return usedIn(1, 0)()
      }
      renderDeletableDetail()
      expect(await editTagsButton()).not.toHaveAttribute('aria-disabled', 'true')

      await browserUser.click(await deleteButton())

      // The check is out.
      await waitFor(() => expect(usageReads).toHaveLength(1))
      expect(tag('garment-edit-tags')).toHaveAttribute('aria-disabled', 'true')
      expect(tag('garment-delete')).toHaveAttribute('aria-disabled', 'true')

      usageAnswer.open()

      // The prompt is up.
      await screen.findByTestId('garment-delete-confirm')
      expect(tag('garment-edit-tags')).toHaveAttribute('aria-disabled', 'true')

      await browserUser.click(screen.getByRole('button', { name: 'Keep it' }))

      await waitFor(() =>
        expect(tag('garment-edit-tags')).not.toHaveAttribute('aria-disabled', 'true')
      )
      expect(tag('garment-delete')).not.toHaveAttribute('aria-disabled', 'true')
      expect(screen.queryByTestId('garment-delete-confirm')).toBeNull()
      expect(events).toEqual([])
      expect(deletes).toEqual([])
    })
  })
})
