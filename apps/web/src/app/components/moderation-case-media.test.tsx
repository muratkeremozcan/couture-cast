// Learning path Step 50: Moderator queue and case detail.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-50-moderator-queue-and-case-detail
// Story 6.10 test owner: C-WEB-Q-MEDIA. The signed URL is the grant: it stays in one plain img.
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModerationMedia } from '@couture/api-client/contracts/http'
import { CaseMedia } from './moderation-case-media'

const SERVER = Date.parse('2026-11-03T12:00:00.000Z')
const URL_SECRET =
  'https://storage.test/object/sign/community/p1/a.jpg?token=SIGNED-SECRET&ttl=120'
const available = (
  expiresInMs = 120_000,
  altText: string | null = 'A described outfit'
): ModerationMedia => ({
  state: 'available',
  url: URL_SECRET,
  expiresAt: new Date(SERVER + expiresInMs).toISOString(),
  altText,
})

afterEach(() => vi.useRealTimers())

function pinBrowserClock(offsetFromServerMs = 0) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(SERVER + offsetFromServerMs))
}

describe('C-WEB-Q-MEDIA: the image element', () => {
  it('renders the signed URL in a plain img with no referrer, no srcset and no optimizer', () => {
    pinBrowserClock()
    render(<CaseMedia media={available()} clockOffsetMs={0} onReload={() => undefined} />)
    const image = screen.getByRole('img', { name: 'A described outfit' })
    expect(image).toHaveAttribute('src', URL_SECRET)
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(image).not.toHaveAttribute('srcset')
    expect(image.getAttribute('src')).not.toContain('/_next/image')
    expect(image.tagName).toBe('IMG')
  })

  it('keeps the URL out of links, text, titles and data attributes', () => {
    pinBrowserClock()
    const { container } = render(
      <CaseMedia media={available()} clockOffsetMs={0} onReload={() => undefined} />
    )
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).not.toContain('SIGNED-SECRET')
    const carriers = [...container.querySelectorAll('*')].filter(
      (element) =>
        element.tagName !== 'IMG' &&
        [...element.attributes].some((attribute) =>
          attribute.value.includes('SIGNED-SECRET')
        )
    )
    expect(carriers).toEqual([])
  })

  it('describes an image with no alt text by a localized phrase, never an empty alt', () => {
    pinBrowserClock()
    render(
      <CaseMedia
        media={available(120_000, null)}
        clockOffsetMs={0}
        onReload={() => undefined}
      />
    )
    expect(
      screen.getByRole('img', { name: 'No description provided' })
    ).toBeInTheDocument()
  })
})

describe('C-WEB-Q-MEDIA: expiry on the server clock', () => {
  it('swaps the image for an expired state with Reload exactly when the link expires', async () => {
    pinBrowserClock()
    const onReload = vi.fn()
    render(<CaseMedia media={available()} clockOffsetMs={0} onReload={onReload} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(119_999)
    })
    expect(screen.getByRole('img')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('The image link expired.')).toBeInTheDocument()
    vi.useRealTimers()
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('counts from the server offset when the browser clock runs ten minutes ahead', async () => {
    pinBrowserClock(10 * 60_000)
    render(
      <CaseMedia
        media={available()}
        clockOffsetMs={-10 * 60_000}
        onReload={() => undefined}
      />
    )
    // The browser clock says the link expired nine minutes ago. The server clock says 120 s are left.
    expect(screen.getByRole('img')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(119_000)
    })
    expect(screen.getByRole('img')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByText('The image link expired.')).toBeInTheDocument()
  })

  it('shows the expired state at once when the link had expired before it rendered', () => {
    pinBrowserClock()
    render(
      <CaseMedia media={available(-1)} clockOffsetMs={0} onReload={() => undefined} />
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('The image link expired.')).toBeInTheDocument()
  })

  it('shows a fresh image again when a reload delivers a new link', async () => {
    pinBrowserClock()
    const { rerender } = render(
      <CaseMedia media={available()} clockOffsetMs={0} onReload={() => undefined} />
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(121_000)
    })
    expect(screen.getByText('The image link expired.')).toBeInTheDocument()
    const reloaded: ModerationMedia = {
      state: 'available',
      url: `${URL_SECRET}&v=2`,
      expiresAt: new Date(SERVER + 121_000 + 120_000).toISOString(),
      altText: 'A described outfit',
    }
    rerender(<CaseMedia media={reloaded} clockOffsetMs={0} onReload={() => undefined} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', `${URL_SECRET}&v=2`)
  })

  it('clears its timer on unmount', () => {
    pinBrowserClock()
    const { unmount } = render(
      <CaseMedia media={available()} clockOffsetMs={0} onReload={() => undefined} />
    )
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('C-WEB-Q-MEDIA: failure and unavailable states', () => {
  it('offers Reload when the browser cannot load the image', async () => {
    pinBrowserClock()
    const onReload = vi.fn()
    render(<CaseMedia media={available()} clockOffsetMs={0} onReload={onReload} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText('The image could not be loaded.')).toBeInTheDocument()
    vi.useRealTimers()
    await userEvent.click(screen.getByRole('button', { name: 'Reload case' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['target_erased', 'The post was erased, so its image is gone.'],
    ['anonymized', 'The post was anonymized, so its image is gone.'],
    ['purged', 'The image was purged.'],
    ['no_image', 'This case has no image.'],
    ['signing_failed', 'The image could not be loaded.'],
  ] as const)('explains %s in words and renders no image or button', (reason, text) => {
    render(
      <CaseMedia
        media={{ state: 'unavailable', reason }}
        clockOffsetMs={0}
        onReload={() => undefined}
      />
    )
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // The closed code never reaches the page; the words do.
    expect(document.body.textContent).not.toContain('moderation.mediaReason')
    if (reason.includes('_')) expect(document.body.textContent).not.toContain(reason)
  })
})
