import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { themedTextPropsSpy } = vi.hoisted(() => ({
  themedTextPropsSpy: vi.fn(),
}))

vi.mock('./themed', () => ({
  Text: (props: { children: ReactNode; style?: unknown }) => {
    themedTextPropsSpy(props)
    return <span>{props.children}</span>
  },
}))

import { MonoText } from './styled-text'

describe('MonoText', () => {
  beforeEach(() => {
    themedTextPropsSpy.mockClear()
  })

  it('renders the provided content', () => {
    render(<MonoText>Snapshot test!</MonoText>)

    expect(screen.getByText('Snapshot test!')).toBeDefined()
  })

  it('applies the mono font style', () => {
    render(<MonoText>Styled content</MonoText>)

    const latestProps = themedTextPropsSpy.mock.calls.at(-1)?.[0] as
      | { style?: unknown[] }
      | undefined

    expect(latestProps).toBeDefined()
    expect(Array.isArray(latestProps?.style)).toBe(true)
    expect(latestProps?.style).toContainEqual({ fontFamily: 'SpaceMono' })
  })
})
