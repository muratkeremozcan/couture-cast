// Learning path Step 46: Home spotlight teaser.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-46-home-spotlight-teaser
// Story 6.7: the InfoBanner contract the Community spotlight notice relies on.
import { createRef } from 'react'
import type { View } from 'react-native'
import { act, screen } from '@testing-library/react'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '@/src/lib/i18n'
import { InfoBanner } from './info-banner'

const banner = () => screen.getByTestId('deep-link-info-banner')
const dismissButton = () =>
  banner().querySelector<HTMLElement>('[role="button"]') as HTMLElement

describe('6.7 InfoBanner', () => {
  // The dismiss control's label comes from the app's i18n instance.
  beforeAll(async () => {
    await initI18n()
  })

  it('6.7-MOB-042 forwards its ref to the message node a caller moves focus to', async () => {
    const ref = createRef<View>()
    await render(<InfoBanner ref={ref} message="Look unavailable." />)
    const message = screen.getByTestId('deep-link-info-banner-message')
    expect(ref.current).toBe(message)
    expect(message.getAttribute('aria-label')).toBe('Look unavailable.')
    // Focusable from code without becoming a tab stop.
    expect(message.getAttribute('tabindex')).toBe('-1')
  })

  it('6.7-MOB-043 is a polite live region by default and off when liveRegion is false', async () => {
    const view = await render(<InfoBanner message="Invalid link." />)
    expect(banner().getAttribute('aria-live')).toBe('polite')
    await view.rerender(<InfoBanner message="Look unavailable." liveRegion={false} />)
    expect(banner().getAttribute('aria-live')).toBe('off')
  })

  it('6.7-MOB-044 keeps one mounted instance while its message changes', async () => {
    const view = await render(<InfoBanner message="Invalid link." />)
    const first = banner()
    await view.rerender(<InfoBanner message="Look unavailable." liveRegion={false} />)
    expect(banner()).toBe(first)
    expect(screen.getByTestId('deep-link-info-banner-message').textContent).toContain(
      'Look unavailable.'
    )
  })

  it('6.7-MOB-045 a dismissal belongs to its message: a new message shows again', async () => {
    const onDismiss = vi.fn()
    const view = await render(
      <InfoBanner message="Invalid link." onDismiss={onDismiss} />
    )
    await userEvent.click(dismissButton())
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()

    // The same message stays dismissed across a re-render.
    await view.rerender(<InfoBanner message="Invalid link." onDismiss={onDismiss} />)
    expect(screen.queryByTestId('deep-link-info-banner')).toBeNull()

    await act(async () => {
      await view.rerender(
        <InfoBanner
          message="Look unavailable."
          onDismiss={onDismiss}
          liveRegion={false}
        />
      )
    })
    expect(screen.getByTestId('deep-link-info-banner-message').textContent).toContain(
      'Look unavailable.'
    )
  })
})
