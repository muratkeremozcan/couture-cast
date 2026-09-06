// Learning path Step 38: Community feed by climate band.
// Story 6.1 Task 8 owner: the report dialog.
import React, { createElement, useState } from 'react'
import { run as runAxe } from 'axe-core'
import type * as ReactNativeModule from 'react-native'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  communityReportReasonSchema,
  type CommunityFeedItem,
} from '@couture/api-client/contracts/http'

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
}))

/**
 * `accessibilityState` is a NATIVE-only prop that react-native-web does not forward,
 * so the radio group's checked state cannot be read off the DOM. The recorder renders
 * the REAL `TouchableOpacity`, so presses, the focus trap and the axe scan below all
 * still run against the real component.
 */
const touchableSpy = vi.hoisted(() => ({
  props: new Map<string, Record<string, unknown>>(),
  createElement: null as unknown as typeof createElement,
}))
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNativeModule>()
  const RealTouchable = actual.TouchableOpacity
  function RecordingTouchable(props: Record<string, unknown>) {
    if (typeof props.testID === 'string') {
      touchableSpy.props.set(props.testID, props)
    }
    return touchableSpy.createElement(RealTouchable as never, props)
  }
  return {
    ...actual,
    // `Platform.OS` is redefined per test because the dialog's focus move only
    // runs off web, and react-native-web's own `findNodeHandle` throws
    // unconditionally. Same shape as `wardrobe/capsule-builder-modal.test.tsx`.
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: vi.fn(),
    },
    findNodeHandle: vi.fn(),
    Platform: { ...actual.Platform, OS: 'web' },
    TouchableOpacity: RecordingTouchable,
  }
})

touchableSpy.createElement = createElement

import { AccessibilityInfo, Platform, findNodeHandle } from 'react-native'
import enUS from '@/assets/locales/en-US.json'
import i18n, { initI18n } from '@/src/lib/i18n'
import { press } from '@/src/test-utils/press'
import { CommunityReportModal } from './community-report-modal'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const POST: CommunityFeedItem = {
  id: 'post-a',
  caption: null,
  altText: 'A charcoal wool coat over a cream knit.',
  climateBand: 'temperate_wet',
  imageAccess: {
    url: 'https://storage.test/a.jpg',
    expiresAt: '2030-01-01T00:00:00.000Z',
  },
  publishedAt: '2026-09-05T12:00:00.000Z',
  createdAt: '2026-09-05T11:00:00.000Z',
  status: 'published',
  challengeId: null,
  author: { displayName: 'Style Explorer A1B2', isSelf: false },
}

function renderModal(
  props: Partial<React.ComponentProps<typeof CommunityReportModal>> = {}
) {
  const onClose = vi.fn()
  const onSubmit = vi.fn()
  const utils = render(
    <CommunityReportModal
      visible
      post={POST}
      onClose={onClose}
      onSubmit={onSubmit}
      {...props}
    />
  )
  return { ...utils, onClose, onSubmit }
}

/** A real button outside the dialog, so focus has somewhere to be restored to. */
function ReportHarness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Report
      </button>
      <CommunityReportModal
        visible={open}
        post={POST}
        onClose={() => setOpen(false)}
        onSubmit={vi.fn()}
      />
    </>
  )
}

describe('CommunityReportModal (Story 6.1)', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    touchableSpy.props.clear()
  })

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true })
  })

  it('6.1-MOB-073 moves accessibility focus into the dialog on a native surface', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    vi.mocked(findNodeHandle).mockReturnValue(41)

    renderModal()

    // Focus containment starts by moving the reader in; react-native-web's own
    // trap does this on web, so the explicit move is native-only.
    await waitFor(() =>
      expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(41)
    )
  })

  it('6.1-MOB-074 refuses to submit a report with no post behind it', () => {
    const { onSubmit } = renderModal({ post: null })

    press(screen.getByTestId('report-reason-spam'))
    press(screen.getByTestId('submit-report-button'))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('6.1-MOB-051 announces itself as a modal dialog labelled by its own title', async () => {
    renderModal()

    const dialog = screen.getByTestId('community-report-modal')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain(enUS.community.report.title)
    expect(dialog.textContent).toContain(enUS.community.report.description)
    await waitFor(() => expect(dialog.getAttribute('role')).toBe('dialog'))
  })

  it('6.1-MOB-052 contains focus while open and gives it back to the opener', async () => {
    render(<ReportHarness />)

    const opener = screen.getByTestId('opener')
    opener.focus()
    fireEvent.click(opener)

    const dialog = await screen.findByTestId('community-report-modal')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    press(screen.getByTestId('cancel-report-button'))

    await waitFor(() => expect(screen.queryByTestId('community-report-modal')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('6.1-MOB-053 offers every contract reason and marks the choice with a shape', () => {
    renderModal()

    for (const reason of communityReportReasonSchema.options) {
      const option = screen.getByTestId(`report-reason-${reason}`)
      expect(option.getAttribute('aria-label')).toBe(enUS.community.report.reason[reason])
      expect(touchableSpy.props.get(`report-reason-${reason}`)).toMatchObject({
        accessibilityRole: 'radio',
        accessibilityState: { selected: false, checked: false },
      })
      // Shape, not colour: an unselected option carries no check mark.
      expect(option.textContent).not.toContain('✓')
    }

    press(screen.getByTestId('report-reason-hate_speech'))

    expect(screen.getByTestId('report-reason-hate_speech').textContent).toContain('✓')
    expect(touchableSpy.props.get('report-reason-hate_speech')).toMatchObject({
      accessibilityState: { selected: true, checked: true },
    })
    expect(screen.getByTestId('report-reason-spam').textContent).not.toContain('✓')
  })

  it('6.1-MOB-054 keeps submit dead until a reason is chosen and says why', () => {
    const { onSubmit } = renderModal()

    const submit = screen.getByTestId('submit-report-button')
    expect(submit.getAttribute('aria-disabled')).toBe('true')
    // The reason the control is dead is spoken, never implied by dimming alone.
    expect(touchableSpy.props.get('submit-report-button')).toMatchObject({
      accessibilityHint: enUS.community.report.reasonLabel,
    })
    press(submit)
    expect(onSubmit).not.toHaveBeenCalled()

    press(screen.getByTestId('report-reason-spam'))
    expect(
      screen.getByTestId('submit-report-button').getAttribute('aria-disabled')
    ).not.toBe('true')
    expect(touchableSpy.props.get('submit-report-button')?.accessibilityHint).toBe(
      undefined
    )
  })

  it('6.1-MOB-055 submits the trimmed details, and omits them when they are blank', () => {
    const { onSubmit } = renderModal()

    press(screen.getByTestId('report-reason-spam'))
    fireEvent.change(screen.getByTestId('report-details-input'), {
      target: { value: '   ' },
    })
    press(screen.getByTestId('submit-report-button'))
    expect(onSubmit).toHaveBeenLastCalledWith('post-a', 'spam', undefined)

    fireEvent.change(screen.getByTestId('report-details-input'), {
      target: { value: '  Reposted stock photography.  ' },
    })
    press(screen.getByTestId('submit-report-button'))
    expect(onSubmit).toHaveBeenLastCalledWith(
      'post-a',
      'spam',
      'Reposted stock photography.'
    )
  })

  it('6.1-MOB-056 counts the details characters and renders the error the screen translated', () => {
    renderModal({ errorMessage: enUS.community.error.rateLimited })

    fireEvent.change(screen.getByTestId('report-details-input'), {
      target: { value: 'abcde' },
    })
    expect(screen.getByTestId('report-details-count').textContent).toBe(
      '5 of 500 characters'
    )

    const error = screen.getByTestId('report-error-message')
    expect(error.textContent).toBe(enUS.community.error.rateLimited)
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.getAttribute('aria-live')).toBe('assertive')
  })

  it('6.1-MOB-057 announces the busy state and blocks both controls while submitting', () => {
    const { onClose, onSubmit } = renderModal({ isSubmitting: true })

    const submit = screen.getByTestId('submit-report-button')
    expect(submit.getAttribute('aria-disabled')).toBe('true')
    expect(submit.getAttribute('aria-label')).toBe(enUS.community.report.submitting)
    press(submit)
    expect(onSubmit).not.toHaveBeenCalled()

    press(screen.getByTestId('cancel-report-button'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('6.1-MOB-058 forgets the reason and the details once it closes', async () => {
    const { rerender, onClose, onSubmit } = renderModal()

    press(screen.getByTestId('report-reason-other'))
    fireEvent.change(screen.getByTestId('report-details-input'), {
      target: { value: 'Something else entirely.' },
    })

    rerender(
      <CommunityReportModal
        visible={false}
        post={POST}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    )
    rerender(
      <CommunityReportModal visible post={POST} onClose={onClose} onSubmit={onSubmit} />
    )

    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('report-details-input').value).toBe(
        ''
      )
    )
    expect(screen.getByTestId('submit-report-button').getAttribute('aria-disabled')).toBe(
      'true'
    )
  })

  it('6.1-MOB-059 has no axe violations', async () => {
    renderModal({ errorMessage: enUS.community.error.report })
    press(screen.getByTestId('report-reason-violence'))
    const dialog = screen.getByTestId('community-report-modal')
    // react-native-web's own `ModalContent` puts `aria-modal` on the wrapper before
    // it puts `role="dialog"` there, and only promotes the role once the open
    // animation ends. Scanning inside that 250ms window reports RNW's transient
    // markup rather than this component's, so the scan waits for the dialog.
    await waitFor(() => expect(dialog.getAttribute('role')).toBe('dialog'))

    // The dialog is portalled out of the render container, so the scan targets the
    // document.
    const results = await runAxe(document.body, {
      runOnly: { type: 'tag', values: AXE_TAGS },
    })

    expect(
      results.violations.map((violation) => violation.id),
      JSON.stringify(results.violations, null, 2)
    ).toEqual([])

    /*
     * The regression this guards. React Native's `accessibilityState` object is
     * native-only -- react-native-web's `forwardedProps` table carries
     * `aria-checked` and `accessibilityChecked` and nothing for the object form --
     * so every `role="radio"` here rendered with NO `aria-checked` and axe failed
     * `aria-required-attr` under WCAG 4.1.2. `app.json` ships a web target
     * (`web.bundler: metro`), so that was a real failure on that surface rather
     * than a harness artefact. Asserting the attribute directly means dropping the
     * `aria-checked` prop fails here by name, not as an anonymous axe count.
     */
    const radios = communityReportReasonSchema.options.map((reason) =>
      screen.getByTestId(`report-reason-${reason}`)
    )
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(
      communityReportReasonSchema.options.map((reason) =>
        reason === 'violence' ? 'true' : 'false'
      )
    )
  })
})
