// Learning path Step 75: Find mini skirts, tights and socks.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-75-find-mini-skirts-tights-and-socks
import { getGuestPreviewStrings, SAMPLE_CATALOG, todayCatalogSlot } from '@couture/utils'
import { screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { TodayOutfitPicture } from './today-outfit-picture'

const tights = SAMPLE_CATALOG.garments.find(({ id }) => id === 'sample:g:opaque-tights')!
const socks = SAMPLE_CATALOG.garments.find(({ id }) => id === 'sample:g:ribbed-socks')!
const scarf = SAMPLE_CATALOG.garments.find(({ id }) => id === 'sample:g:wool-scarf')!

it('[7.18-SWAP-002] expands the native sample picture past 12 choices and selects the last piece', async () => {
  const current = todayCatalogSlot(tights)
  const choose = vi.fn()
  const candidates = [
    scarf,
    ...Array.from({ length: 11 }, (_, index) => ({
      ...socks,
      id: `sample:g:socks-fixture-${index + 1}`,
    })),
  ]
  const view = await render(
    <TodayOutfitPicture
      slots={[current]}
      strings={getGuestPreviewStrings('en-US')}
      getSampleOptions={() => ({ current: tights, candidates, range: 'mild' })}
      onChoose={choose}
    />
  )
  const opener = screen.getByTestId('today-outfit-slot-0')
  await userEvent.click(opener)
  const sheet = within(await screen.findByTestId('today-outfit-swap'))
  expect(sheet.getAllByRole('radio')).toHaveLength(12)
  expect(sheet.getByRole('radio', { checked: true })).toHaveAccessibleName(
    /Opaque tights.*current/i
  )
  expect(
    within(sheet.getByRole('group', { name: 'Socks' })).getAllByRole('radio')
  ).toHaveLength(11)
  expect(sheet.queryByRole('group', { name: 'Scarves' })).toBeNull()

  await userEvent.click(screen.getByTestId('today-outfit-swap-show-more'))
  expect(sheet.getAllByRole('radio')).toHaveLength(13)
  const scarfGroup = sheet.getByRole('group', { name: 'Scarves' })
  const revealed = within(scarfGroup).getByTestId('today-outfit-swap-option-12')
  await waitFor(() => expect(revealed).toHaveFocus())
  await userEvent.click(revealed)
  expect(choose).toHaveBeenCalledExactlyOnceWith(0, todayCatalogSlot(scarf))
  await waitFor(() => expect(screen.queryByTestId('today-outfit-swap')).toBeNull())

  await userEvent.click(opener)
  const reopened = within(await screen.findByTestId('today-outfit-swap'))
  expect(reopened.getAllByRole('radio')).toHaveLength(12)
  expect(screen.getByTestId('today-outfit-swap-show-more')).toBeVisible()
  await view.unmount()
})
