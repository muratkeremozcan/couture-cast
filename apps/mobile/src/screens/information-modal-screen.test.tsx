import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Platform } from 'react-native'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

const { analyticsCaptureMock, routerBackMock, statusBarMock } = vi.hoisted(() => ({
  analyticsCaptureMock: vi.fn(),
  routerBackMock: vi.fn(),
  statusBarMock: vi.fn(),
}))

// expo-status-bar is a native boundary and, when loaded through the browser
// dep pre-bundle, drags in a second copy of React. Stubbing it keeps the
// screen renderable and lets the chosen bar style be asserted directly.
vi.mock('expo-status-bar', () => ({
  StatusBar: (props: { style?: string }) => {
    statusBarMock(props.style)
    return null
  },
}))

vi.mock('@/src/analytics/mobile-analytics', () => ({
  useMobileAnalytics: () => ({
    capture: analyticsCaptureMock,
    getDistinctId: () => 'test-user-id',
  }),
}))

vi.mock('expo-router', () => ({
  useRouter: () => ({ back: routerBackMock }),
}))

import i18n, { initI18n } from '../lib/i18n'
import ModalScreen from '../../app/modal'

describe('ModalScreen', () => {
  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    analyticsCaptureMock.mockReset()
    routerBackMock.mockReset()
    statusBarMock.mockReset()
    await i18n.changeLanguage('en-US')
  })

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
  })

  it('presents the about copy as a modal region and reports the open event', async () => {
    render(<ModalScreen />)

    // The screen is presented over the tab stack, so the region carries its own
    // name and heading rather than inheriting the tab it was opened from.
    expect(screen.getByTestId('information-modal')).toHaveAttribute(
      'aria-label',
      'About CoutureCast'
    )
    expect(screen.getByRole('heading', { name: 'About CoutureCast' })).toBeInTheDocument()

    await waitFor(() => {
      expect(analyticsCaptureMock).toHaveBeenCalledWith('modal_opened')
    })
  })

  it('dismisses back to the screen that opened it', () => {
    render(<ModalScreen />)

    fireEvent.click(screen.getByTestId('information-modal-close'))

    expect(routerBackMock).toHaveBeenCalledOnce()
  })

  it('renders the about copy in the active locale', async () => {
    await i18n.changeLanguage('tr-TR')

    render(<ModalScreen />)

    expect(screen.getByTestId('information-modal')).toHaveAttribute(
      'aria-label',
      i18n.t('common.about_couturecast')
    )
    expect(screen.getByText(i18n.t('common.about_description'))).toBeInTheDocument()
  })

  it('uses a light status bar on iOS, where the modal sheet is dark', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })

    render(<ModalScreen />)

    expect(statusBarMock).toHaveBeenCalledWith('light')
  })

  it('leaves the status bar automatic on other platforms', () => {
    render(<ModalScreen />)

    expect(statusBarMock).toHaveBeenCalledWith('auto')
  })
})
