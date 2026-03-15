import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const { captureMock, openBrowserAsyncMock, preventDefaultMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  openBrowserAsyncMock: vi.fn(),
  preventDefaultMock: vi.fn(),
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: captureMock,
  }),
}))

vi.mock('expo-web-browser', () => ({
  openBrowserAsync: openBrowserAsyncMock,
}))

vi.mock('expo-router', () => ({
  Link: (props: {
    children: ReactNode
    onPress?: (event: { preventDefault: () => void }) => void
  }) => (
    <button
      type="button"
      data-testid="external-link"
      onClick={() => props.onPress?.({ preventDefault: preventDefaultMock })}
    >
      {props.children}
    </button>
  ),
}))

import { ExternalLink } from './external-link'

describe('ExternalLink', () => {
  it('tracks taps and defers native browser opening on web', () => {
    render(<ExternalLink href={'https://example.com' as never}>Docs</ExternalLink>)

    fireEvent.click(screen.getByTestId('external-link'))

    expect(captureMock).toHaveBeenCalledWith('external_link_tapped', {
      url: 'https://example.com',
    })
    expect(preventDefaultMock).not.toHaveBeenCalled()
    expect(openBrowserAsyncMock).not.toHaveBeenCalled()
  })
})
