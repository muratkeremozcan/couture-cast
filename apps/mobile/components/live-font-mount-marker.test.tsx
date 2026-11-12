// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ extra: {} as Record<string, unknown>, dev: true }))

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra: config.extra }
    },
  },
}))

import {
  LiveFontMountMarker,
  liveFontMountMarkersEnabled,
} from './live-font-mount-marker'

const marker = () =>
  document.querySelector<HTMLElement>('[data-testid^="live-font-mount-home-"]')

describe('LiveFontMountMarker', () => {
  beforeEach(() => {
    config.extra = {}
  })

  it('keeps one id across re-renders of the same mount', () => {
    const { rerender } = render(<LiveFontMountMarker scope="home" />)
    const first = marker()?.dataset.testid
    expect(first).toMatch(/^live-font-mount-home-[a-z0-9]+$/)

    rerender(<LiveFontMountMarker scope="home" />)

    expect(marker()?.dataset.testid).toBe(first)
  })

  /** A remount, or an Activity recreation that remounts the root, must read as new. */
  it('takes a new id when the screen mounts again', () => {
    const first = render(<LiveFontMountMarker scope="home" />)
    const before = marker()?.dataset.testid
    first.unmount()

    render(<LiveFontMountMarker scope="home" />)

    expect(marker()?.dataset.testid).not.toBe(before)
  })

  it('reports the font scale JavaScript sees', () => {
    render(<LiveFontMountMarker scope="home" />)

    expect(
      document
        .querySelector('[data-testid^="live-font-scale-home-"]')
        ?.getAttribute('data-testid')
    ).toMatch(/^live-font-scale-home-\d+(\.\d+)?$/)
  })

  it('reports the React Native version and the applied configuration', () => {
    render(<LiveFontMountMarker scope="home" />)

    expect(
      document
        .querySelector('[data-testid^="live-font-env-home~"]')
        ?.getAttribute('data-testid')
    ).toMatch(
      /^live-font-env-home~(\d+\.\d+\.\d+[^~]*|web)~(light|dark)~(ltr|rtl)~\d+(\.\d+)?~[a-zA-Z-]+$/
    )
  })

  it('stays out of the accessibility tree', () => {
    render(<LiveFontMountMarker scope="home" />)

    expect(marker()?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('renders in development builds and in native test builds only', () => {
    expect(liveFontMountMarkersEnabled({ dev: true })).toBe(true)
    expect(liveFontMountMarkersEnabled({ dev: false })).toBe(false)
    config.extra = { liveFontMountMarkers: true }
    expect(liveFontMountMarkersEnabled({ dev: false })).toBe(true)
  })
})
