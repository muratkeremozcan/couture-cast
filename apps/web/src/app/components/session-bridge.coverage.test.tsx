// Learning path Step 43: Realtime engagement and push notifications.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-43-realtime-engagement-and-push-notifications
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
const start = vi.hoisted(() => vi.fn())
vi.mock('../../lib/web-session', () => ({ startWebSession: start }))
import { getI18n } from '../../i18n'
import { SessionBridge } from './session-bridge'
describe('session bridge lifecycle ownership', () => {
  it('disposes an installed session when its host unmounts', async () => {
    const cleanup = vi.fn()
    start.mockResolvedValue(cleanup)
    const view = render(<SessionBridge />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(cleanup).not.toHaveBeenCalled()
    view.unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('disposes late session installation after its host has already unmounted', async () => {
    let finish!: (cleanup: () => void) => void
    start.mockReturnValue(
      new Promise<() => void>((resolve) => {
        finish = resolve
      })
    )
    const cleanup = vi.fn()
    const view = render(<SessionBridge />)
    view.unmount()
    await act(async () => {
      finish(cleanup)
      await Promise.resolve()
    })
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('names the rendered language on the document and follows later changes (WCAG 3.1.1)', async () => {
    start.mockResolvedValue(vi.fn())
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    const view = render(<SessionBridge />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.documentElement.lang).toBe('de-DE')
    await act(async () => {
      await getI18n().changeLanguage('pt-BR')
    })
    expect(document.documentElement.lang).toBe('pt-BR')
    view.unmount()
    await act(async () => {
      await getI18n().changeLanguage('tr-TR')
    })
    expect(document.documentElement.lang).toBe('pt-BR')
    languages.mockRestore()
    await getI18n().changeLanguage('en-US')
  })
  it('contains startup rejection without inventing a cleanup callback', async () => {
    start.mockRejectedValue(new Error('SDK unavailable'))
    const view = render(<SessionBridge />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(view.container).toBeEmptyDOMElement()
    expect(() => view.unmount()).not.toThrow()
  })
})
