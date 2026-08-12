// Learning path Step 28: Accessibility hardening.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-28-accessibility-hardening
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SkipToContent } from './skip-to-content'

describe('accessibility hardening web suite', () => {
  it('renders the skip link with the shared main target', () => {
    render(<SkipToContent />)

    const skipLink = screen.getByRole('link', { name: /skip to main content/i })
    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(skipLink).toHaveClass('sr-only')
    expect(skipLink).not.toHaveClass('focus:outline-none')
  })

  it('keeps the skip link as the first rendered focusable element', () => {
    render(
      <>
        <SkipToContent />
        <button type="button">Next control</button>
      </>
    )

    expect(document.querySelectorAll('a[href], button')[0]).toHaveAccessibleName(
      'Skip to main content'
    )
  })
})
