// Learning path Step 75: Find mini skirts, tights and socks.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-75-find-mini-skirts-tights-and-socks
import { getGuestPreviewStrings, SAMPLE_CATALOG } from '@couture/utils'
import { screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { Pressable, Text } from 'react-native'
import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { useHeroPalette } from '@/components/hero/hero-theme'
import { PreviewSwapSheet } from './guest-preview-parts'

it('[7.18-SWAP-002] focuses the revealed row and resets the native editor sheet on reopen', async () => {
  const current = SAMPLE_CATALOG.garments.find(
    ({ id }) => id === 'sample:g:opaque-tights'
  )!
  const socks = SAMPLE_CATALOG.garments.find(({ id }) => id === 'sample:g:ribbed-socks')!
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    ...socks,
    id: `sample:g:socks-fixture-${index + 1}`,
  }))
  const choose = vi.fn()

  function Fixture() {
    const [open, setOpen] = useState(false)
    const palette = useHeroPalette()
    return (
      <>
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
          <Text>Swap accessory</Text>
        </Pressable>
        <PreviewSwapSheet
          category={open ? 'accessory' : null}
          candidates={candidates}
          current={current}
          range="mild"
          strings={getGuestPreviewStrings('en-US')}
          palette={palette}
          onChoose={(id) => {
            choose(id)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      </>
    )
  }

  const view = await render(<Fixture />)
  const opener = screen.getByRole('button', { name: 'Swap accessory' })
  await userEvent.click(opener)
  const sheet = within(await screen.findByTestId('guest-preview-swap-sheet'))
  expect(sheet.getAllByRole('radio')).toHaveLength(12)
  expect(sheet.getByRole('radio', { checked: true })).toHaveAccessibleName(
    /Opaque tights.*current/i
  )

  await userEvent.click(sheet.getByRole('button', { name: 'Show more' }))
  expect(sheet.getAllByRole('radio')).toHaveLength(13)
  const revealed = sheet.getByTestId('guest-preview-swap-option-socks-fixture-12')
  await waitFor(() => expect(revealed).toHaveFocus())
  await userEvent.click(revealed)
  expect(choose).toHaveBeenCalledExactlyOnceWith('sample:g:socks-fixture-12')
  await waitFor(() => expect(screen.queryByTestId('guest-preview-swap-sheet')).toBeNull())

  await userEvent.click(opener)
  const reopened = within(await screen.findByTestId('guest-preview-swap-sheet'))
  expect(reopened.getAllByRole('radio')).toHaveLength(12)
  expect(reopened.getByRole('button', { name: 'Show more' })).toBeVisible()
  await view.unmount()
})
