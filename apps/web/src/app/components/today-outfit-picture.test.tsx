// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import { getGuestPreviewStrings, type TodaySlot } from '@couture/utils'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TodayOutfitPicture } from './today-outfit-picture'

const top: TodaySlot = {
  itemId: 'member-top',
  category: 'top',
  kind: 'garment',
  art: { key: '', primary: '', secondary: '' },
  imageAccess: {
    url: 'https://storage.example.test/top.png',
    expiresAt: '2026-11-20T15:10:00.000Z',
  },
}
const bottom: TodaySlot = {
  itemId: 'sample:g:chinos',
  category: 'bottom',
  kind: 'catalog',
  art: { key: 'trousers', primary: '#bca481', secondary: '#8f7652' },
}
const alternative: TodaySlot = { ...bottom, itemId: 'sample:g:dark-jeans' }
const strings = getGuestPreviewStrings('en-US')

function mount(
  slots: TodaySlot[],
  getOptions = (index: number) => [slots[index]!, alternative]
) {
  const choose = vi.fn()
  const view = render(
    <TodayOutfitPicture
      slots={slots}
      strings={strings}
      getOptions={getOptions}
      onChoose={choose}
    />
  )
  return { choose, view }
}

afterEach(() => vi.useRealTimers())

it('exchanges only a loaded photo, then restores catalog art when its access expires', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-20T15:09:59.000Z'))
  mount([top, bottom])
  const first = screen.getByTestId('today-outfit-slot-0')
  expect(within(first).getByTestId('today-outfit-catalog-0')).toBeVisible()
  const image = first.querySelector('img')!
  expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
  fireEvent.load(image)
  expect(within(first).getByTestId('today-outfit-photo-0')).toBeVisible()
  expect(screen.getByTestId('today-outfit-catalog-1')).toBeVisible()

  act(() => {
    vi.advanceTimersByTime(1_000)
  })
  expect(within(first).getByTestId('today-outfit-catalog-0')).toBeVisible()
  expect(first.querySelector('img')).toBeNull()
})

it('keeps failed photo art and lets a neighboring slot open, select and return focus', async () => {
  vi.setSystemTime(new Date('2026-11-20T15:00:00.000Z'))
  const { choose } = mount([top, bottom])
  const user = userEvent.setup()
  const first = screen.getByTestId('today-outfit-slot-0')
  fireEvent.error(first.querySelector('img')!)
  expect(within(first).getByTestId('today-outfit-catalog-0')).toBeVisible()
  expect(first.querySelector('img')).toBeNull()

  const sibling = screen.getByTestId('today-outfit-slot-1')
  await user.click(sibling)
  const swap = screen.getByTestId('today-outfit-swap')
  expect(within(swap).getByRole('radio', { checked: true })).toHaveFocus()
  await user.click(within(swap).getByRole('radio', { checked: false }))
  expect(choose).toHaveBeenCalledExactlyOnceWith(1, alternative)
  expect(sibling).toHaveFocus()
})

it('shows an expired slot as catalog art and closes Swap without a change', async () => {
  const expired = {
    ...top,
    imageAccess: { ...top.imageAccess!, expiresAt: '2000-01-01T00:00:00.000Z' },
  }
  const { choose } = mount([expired], () => [expired])
  const user = userEvent.setup()
  const slot = screen.getByTestId('today-outfit-slot-0')
  expect(slot.querySelector('img')).toBeNull()
  await user.click(slot)
  expect(screen.getByTestId('today-outfit-swap-option-0')).toBeVisible()
  await user.click(screen.getByTestId('today-outfit-swap-option-0'))
  expect(choose).not.toHaveBeenCalled()
  expect(slot).toHaveFocus()
})
