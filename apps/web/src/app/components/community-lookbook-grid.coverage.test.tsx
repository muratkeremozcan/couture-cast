// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../../test-utils/msw/runtime'
import {
  item,
  renderGrid,
  signIn,
  feedHandler,
  setupCommunityGridClock,
  installImagePrepMocks,
  choosePhoto,
  imageFixtureHandler,
  allocateBody,
  ALLOCATE_PATH,
  SUGGESTED_ALT_TEXT,
} from '../../test-utils/community-lookbook-grid'
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))
setupCommunityGridClock()
afterEach(() => {
  window.sessionStorage.clear()
})
describe('community scope erasure', () => {
  it('removes loaded posts and the prepared photo draft when the account is erased', async () => {
    signIn()
    const restore = installImagePrepMocks()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    useMswHandlers(
      feedHandler({ items: [item()] }),
      imageFixtureHandler(),
      http.post(ALLOCATE_PATH, () => allocateBody())
    )
    const view = renderGrid()
    try {
      await screen.findByTestId('lookbook-card-post-1')
      const user = userEvent.setup()
      await user.click(screen.getByTestId('create-post-button'))
      await choosePhoto(user)
      await screen.findByDisplayValue(SUGGESTED_ALT_TEXT)
      act(() => {
        window.dispatchEvent(new Event('couture:account-erased'))
      })
      expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
      expect(screen.queryByTestId('post-caption-input')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(revoke).toHaveBeenCalled()
    } finally {
      view.unmount()
      restore()
    }
  })
  it('clears owner content and session actions when the browser loses its account', async () => {
    signIn()
    useMswHandlers(feedHandler({ items: [item()] }))
    const view = renderGrid()
    await screen.findByTestId('lookbook-card-post-1')
    fireEvent.click(screen.getByTestId('create-post-button'))
    expect(screen.getByRole('dialog')).toBeVisible()
    act(() => {
      window.sessionStorage.clear()
      window.dispatchEvent(new Event('couture:session'))
    })
    expect(screen.queryByTestId('lookbook-card-post-1')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('create-post-button')).toBeNull()
    view.unmount()
  })
})
