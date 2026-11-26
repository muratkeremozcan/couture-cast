// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
// Story CC-7.11 test owner (TEA): 7.11-CMP-MORE-001 to 7.11-CMP-MORE-007, the Closet top bar More
// menu (D5, AC3; Codex 7.11 #14: focus after an outside press). The browser path (menu over the grid, focus return) is the E2E suite's.
// Test design: _bmad-output/test-artifacts/test-design-7-11-five-tab-navigation-back-pattern.md
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import enUS from '../../i18n/locales/en-US.json'
import { ClosetMoreMenu } from './closet-more-menu'

const copy = enUS.wardrobe.menu

const more = () => screen.getByTestId('closet-more-menu')
const menu = () => screen.getByRole('menu', { name: copy.label })
const queryMenu = () => screen.queryByRole('menu')

/** The tests render no app router, so a menu item click must not reach jsdom's navigation. */
function keepClicksInPage(event: MouseEvent) {
  if ((event.target as Element | null)?.closest?.('a[href]')) event.preventDefault()
}
beforeEach(() => window.addEventListener('click', keepClicksInPage))
afterEach(() => window.removeEventListener('click', keepClicksInPage))

describe('7.11 D5 Closet More menu', () => {
  it('7.11-CMP-MORE-001 More is a neutral button that opens a menu of Closet setup then Silhouette, with focus on the first item', async () => {
    const user = userEvent.setup()
    render(<ClosetMoreMenu setupDone={false} />)

    const button = more()
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveTextContent(copy.more)
    // WCAG 2.5.3: the accessible name starts with the visible word.
    expect(button).toHaveAccessibleName(copy.moreLabel)
    expect(copy.moreLabel.startsWith(copy.more)).toBe(true)
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-controls')
    expect(button).not.toHaveAttribute('data-gold')
    expect(queryMenu()).toBeNull()

    await user.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', menu().id)
    const items = within(menu()).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([copy.setup, copy.silhouette])
    expect(items[0]).toHaveAttribute('href', '/wardrobe/onboarding')
    expect(items[0]).toHaveAttribute('data-testid', 'closet-more-setup')
    expect(items[1]).toHaveAttribute('href', '/wardrobe/silhouette')
    expect(items[1]).toHaveAttribute('data-testid', 'closet-more-silhouette')
    expect(items[0]).toHaveFocus()

    await user.click(button)
    expect(queryMenu()).toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('7.11-CMP-MORE-002 the setup item reads exactly "Closet setup: done" once setup is completed', async () => {
    const user = userEvent.setup()
    render(<ClosetMoreMenu setupDone />)

    await user.click(more())

    const setup = screen.getByTestId('closet-more-setup')
    expect(setup).toHaveTextContent(/^Closet setup: done$/)
    expect(setup).toHaveAttribute('href', '/wardrobe/onboarding')
  })

  it('7.11-CMP-MORE-003 Escape closes the menu and returns focus to More', async () => {
    const user = userEvent.setup()
    render(<ClosetMoreMenu setupDone={false} />)

    await user.click(more())
    expect(screen.getByTestId('closet-more-setup')).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(queryMenu()).toBeNull()
    expect(more()).toHaveFocus()
    expect(more()).toHaveAttribute('aria-expanded', 'false')
  })

  it('7.11-CMP-MORE-004 an outside press closes the menu; a press inside it or on More does not', () => {
    render(
      <>
        <ClosetMoreMenu setupDone={false} />
        <p data-testid="outside">Closet grid</p>
      </>
    )

    fireEvent.click(more())
    fireEvent.pointerDown(screen.getByTestId('closet-more-silhouette'))
    expect(menu()).toBeInTheDocument()
    fireEvent.pointerDown(more())
    expect(menu()).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(queryMenu()).toBeNull()
    expect(more()).toHaveAttribute('aria-expanded', 'false')
  })

  it('7.11-CMP-MORE-005 arrow keys, Home and End move between the items; ArrowDown on More opens it', async () => {
    const user = userEvent.setup()
    render(<ClosetMoreMenu setupDone={false} />)
    const setup = () => screen.getByTestId('closet-more-setup')
    const silhouette = () => screen.getByTestId('closet-more-silhouette')

    more().focus()
    await user.keyboard('{ArrowDown}')
    expect(menu()).toBeInTheDocument()
    expect(setup()).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(silhouette()).toHaveFocus()
    // Wraps from the last item to the first, and from the first back to the last.
    await user.keyboard('{ArrowDown}')
    expect(setup()).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(silhouette()).toHaveFocus()
    await user.keyboard('{Home}')
    expect(setup()).toHaveFocus()
    await user.keyboard('{End}')
    expect(silhouette()).toHaveFocus()

    // Other keys leave the menu as it is.
    await user.keyboard('a')
    expect(silhouette()).toHaveFocus()
    expect(menu()).toBeInTheDocument()

    // ArrowDown on More while the menu is open does not reopen or move it.
    more().focus()
    fireEvent.keyDown(more(), { key: 'ArrowDown' })
    expect(menu()).toBeInTheDocument()
    expect(more()).toHaveFocus()
  })

  it('7.11-CMP-MORE-006 Tab away closes the menu without pulling focus back, and choosing an item closes it', async () => {
    const user = userEvent.setup()
    render(<ClosetMoreMenu setupDone={false} />)

    await user.click(more())
    fireEvent.keyDown(screen.getByTestId('closet-more-setup'), { key: 'Tab' })
    expect(queryMenu()).toBeNull()
    expect(more()).not.toHaveFocus()

    await user.click(more())
    await user.click(screen.getByTestId('closet-more-silhouette'))
    expect(queryMenu()).toBeNull()

    await user.click(more())
    await user.click(screen.getByTestId('closet-more-setup'))
    expect(queryMenu()).toBeNull()
  })

  it('[Codex 7.11 #14] 7.11-CMP-MORE-007 an outside press on plain chrome returns focus to More; one on a control leaves focus there', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ClosetMoreMenu setupDone={false} />
        <p data-testid="outside">Closet grid</p>
        <button type="button" data-testid="outside-control">
          Add garment
        </button>
      </>
    )

    await user.click(more())
    expect(screen.getByTestId('closet-more-setup')).toHaveFocus()
    // A press on nothing focusable: the browser moves focus to the body, then the menu closes.
    await user.click(screen.getByTestId('outside'))
    expect(queryMenu()).toBeNull()
    await waitFor(() => expect(more()).toHaveFocus())

    await user.click(more())
    expect(screen.getByTestId('closet-more-setup')).toHaveFocus()
    await user.click(screen.getByTestId('outside-control'))
    expect(queryMenu()).toBeNull()
    expect(screen.getByTestId('outside-control')).toHaveFocus()
    // The deferred return would land on the next task; it never takes focus from the control.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByTestId('outside-control')).toHaveFocus()
    expect(more()).not.toHaveFocus()
  })
})
