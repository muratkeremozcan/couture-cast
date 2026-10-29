import { describe, expect, it } from 'vitest'
import { ShareCardAdmission } from './share-card-admission.js'

const unavailable = () => new Error('render_unavailable')
describe('bounded share-card replacement admission', () => {
  it('keeps active global/member bounds and accepts a replacement only after cancellation settles', async () => {
    const admission = new ShareCardAdmission(1, unavailable)
    const old = new AbortController()
    const release = await admission.acquire('member', old.signal)
    await expect(
      admission.acquire('member', new AbortController().signal)
    ).rejects.toThrow('render_unavailable')
    expect(() => admission.acquire('other', new AbortController().signal)).toThrow(
      'render_unavailable'
    )
    old.abort()
    const pending = admission.acquire('member', new AbortController().signal)
    let entered = false
    void pending.then(() => {
      entered = true
    })
    // Drain every queued microtask, so an entry that takes several ticks is still seen.
    await new Promise((resolve) => setImmediate(resolve))
    expect(entered).toBe(false)
    expect(() => admission.acquire('other', new AbortController().signal)).toThrow()
    release()
    const releaseReplacement = await pending
    expect(entered).toBe(true)
    // Releasing the predecessor twice cannot release the new operation.
    release()
    await expect(
      admission.acquire('member', new AbortController().signal)
    ).rejects.toThrow()
    releaseReplacement()
    const releaseOther = await admission.acquire('other', new AbortController().signal)
    releaseOther()
  })

  it('retains at most the latest queued composition and detaches cancelled waiters', async () => {
    const admission = new ShareCardAdmission(1, unavailable)
    const old = new AbortController()
    const release = await admission.acquire('member', old.signal)
    old.abort()
    const first = admission.acquire('member', new AbortController().signal)
    const firstRefusal = expect(first).rejects.toThrow('render_unavailable')
    const lastParent = new AbortController()
    const last = admission.acquire('member', lastParent.signal)
    await firstRefusal
    const lastRefusal = expect(last).rejects.toThrow('render_unavailable')
    lastParent.abort()
    await lastRefusal
    release()
    const releaseOther = await admission.acquire('other', new AbortController().signal)
    releaseOther()
  })

  it('refuses an already aborted request before reserving any active or waiting capacity', async () => {
    const admission = new ShareCardAdmission(1, unavailable)
    const parent = new AbortController()
    parent.abort()
    await expect(admission.acquire('member', parent.signal)).rejects.toThrow()
    const release = await admission.acquire('other', new AbortController().signal)
    release()
  })
})
