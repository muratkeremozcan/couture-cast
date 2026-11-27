// Learning path Step 75: Find mini skirts, tights and socks.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-75-find-mini-skirts-tights-and-socks
import { getGuestPreviewStrings, SAMPLE_CATALOG } from '@couture/utils'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { expect, it, vi } from 'vitest'
import { GuestPreviewSwapDialog } from './guest-preview-swap-dialog'

const strings = getGuestPreviewStrings('en-US')
const tights = SAMPLE_CATALOG.garments.find(
  (garment) => garment.id === 'sample:g:opaque-tights'
)!
const socks = SAMPLE_CATALOG.garments.find(
  (garment) => garment.id === 'sample:g:ribbed-socks'
)!
const accessories = [
  tights,
  ...Array.from({ length: 12 }, (_, index) => ({
    ...socks,
    id: `sample:g:socks-fixture-${index + 1}`,
  })),
]

function mount(candidates = accessories) {
  const choose = vi.fn()

  function Fixture() {
    const [open, setOpen] = useState(false)
    const opener = useRef<HTMLButtonElement>(null)
    return (
      <>
        <button type="button" ref={opener} onClick={() => setOpen(true)}>
          Swap accessory
        </button>
        <GuestPreviewSwapDialog
          category={open ? 'accessory' : null}
          current={tights}
          candidates={candidates}
          range="mild"
          strings={strings}
          invokerRef={opener}
          onChoose={(id) => {
            choose(id)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      </>
    )
  }

  const user = userEvent.setup()
  render(<Fixture />)
  return { user, choose }
}

it('[7.18-SWAP-002] shows 12 choices including the current piece and resets when reopened', async () => {
  const { user, choose } = mount()
  const opener = screen.getByRole('button', { name: 'Swap accessory' })
  await user.click(opener)
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getAllByRole('radio')).toHaveLength(12)
  expect(
    within(dialog.getByRole('group', { name: 'Socks' })).getAllByRole('radio')
  ).toHaveLength(11)
  expect(dialog.getByRole('radio', { checked: true })).toHaveAccessibleName(
    /Opaque tights.*current/i
  )
  expect(dialog.getByTestId('guest-preview-swap-option-socks-fixture-11')).toBeVisible()
  expect(dialog.queryByTestId('guest-preview-swap-option-socks-fixture-12')).toBeNull()

  await user.click(dialog.getByRole('button', { name: 'Show more' }))
  expect(dialog.getAllByRole('radio')).toHaveLength(13)
  expect(dialog.getByTestId('guest-preview-swap-option-socks-fixture-12')).toBeVisible()
  expect(dialog.queryByRole('button', { name: 'Show more' })).toBeNull()

  await user.click(dialog.getByRole('radio', { checked: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(choose).toHaveBeenCalledExactlyOnceWith(tights.id)
  expect(opener).toHaveFocus()

  await user.click(opener)
  const reopened = within(screen.getByRole('dialog'))
  expect(reopened.getAllByRole('radio')).toHaveLength(12)
  expect(reopened.getByRole('button', { name: 'Show more' })).toBeVisible()
})

it('[7.18-SWAP-001] lets a member close on the current piece when it is the only choice', async () => {
  const { user, choose } = mount([tights])
  await user.click(screen.getByRole('button', { name: 'Swap accessory' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getAllByRole('radio')).toHaveLength(1)
  expect(dialog.queryByRole('button', { name: 'Show more' })).toBeNull()
  await user.click(dialog.getByRole('radio', { checked: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(choose).toHaveBeenCalledExactlyOnceWith(tights.id)
})
