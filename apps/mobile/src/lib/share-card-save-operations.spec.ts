import { describe, expect, it, vi } from 'vitest'
import {
  commitShareCardSave,
  commitShareCardShare,
  ownsPendingShareCardSave,
  subscribeShareCardSave,
  enqueueShareCardCleanup,
  liveShareCardFiles,
  nativeShareCardSavePending,
  retryShareCardCleanup,
  reserveShareCardFile,
} from './share-card-save-operations'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
describe('process-lifetime native save ownership', () => {
  it('U-PENDING-FILE U-SINGLE-WRITE: deferred native read retains immutable file through close/navigation/sign-out', async () => {
    const settled = deferred()
    const files = new Map([['cache/cc68-owned.png', 'immutable-approved-bytes']])
    const cleanup = vi.fn(() => {
      files.delete('cache/cc68-owned.png')
      return Promise.resolve()
    })
    const save = vi.fn(async () => {
      await settled.promise
      expect(files.get('cache/cc68-owned.png')).toBe('immutable-approved-bytes')
    })
    const operation = commitShareCardSave({
      fileUri: 'cache/cc68-owned.png',
      save,
      cleanup,
    })
    expect(nativeShareCardSavePending()).toBe(true)
    // Former composer and identity references are discarded, while the operation keeps the file.
    expect(liveShareCardFiles().has('cache/cc68-owned.png')).toBe(true)
    const second = vi.fn(() => Promise.resolve())
    await expect(
      commitShareCardSave({
        fileUri: 'cache/new-member.png',
        save: second,
        cleanup: second,
      })
    ).rejects.toThrow('finishingSave')
    expect(cleanup).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)
    settled.resolve()
    await operation
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(files.size).toBe(0)
    expect(nativeShareCardSavePending()).toBe(false)
  })
  it('U-STORAGE: native rejection cleans once after settlement and releases the pending guard', async () => {
    const native = deferred()
    const cleanup = vi.fn(() => Promise.resolve())
    const operation = commitShareCardSave({
      fileUri: 'cache/cc68-rejected.png',
      save: () => native.promise,
      cleanup,
    })
    expect(cleanup).not.toHaveBeenCalled()
    const rejected = expect(operation).rejects.toThrow('save_failed')
    native.reject(new Error('save_failed'))
    await rejected
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(nativeShareCardSavePending()).toBe(false)
  })
  it('U-STORAGE: successful import remains success when cleanup fails, cleanup retries never import again', async () => {
    const save = vi.fn(() => Promise.resolve())
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue(undefined)
    await expect(
      commitShareCardSave({ fileUri: 'cache/cc68-cleanup.png', save, cleanup })
    ).resolves.toBeUndefined()
    expect(liveShareCardFiles().has('cache/cc68-cleanup.png')).toBe(true)
    await retryShareCardCleanup()
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(1)
    expect(liveShareCardFiles().size).toBe(0)
  })
  it('U-PENDING-FILE: a UI timeout cannot settle native ownership or admit another write', async () => {
    const native = deferred()
    const cleanup = vi.fn(() => Promise.resolve())
    const operation = commitShareCardSave({
      fileUri: 'cache/cc68-timeout.png',
      save: () => native.promise,
      cleanup,
    })
    vi.useFakeTimers()
    try {
      const ui = Promise.race([
        operation.then(() => 'saved'),
        new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 1000)),
      ])
      let observed: string | undefined
      void ui.then((value) => {
        observed = value
      })
      await vi.advanceTimersByTimeAsync(999)
      expect(observed).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(await ui).toBe('timed-out')
      expect(nativeShareCardSavePending()).toBe(true)
      expect(cleanup).not.toHaveBeenCalled()
    } finally {
      native.resolve()
      await operation
      vi.useRealTimers()
    }
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
  it('L6: queued precommit cleanup protects the file and retries after reservation release', async () => {
    vi.useFakeTimers()
    const uri = 'cache/cc68-precommit-cleanup.png'
    const release = reserveShareCardFile(uri)
    const cleanup = vi.fn(() => Promise.resolve())
    try {
      enqueueShareCardCleanup(uri, cleanup)
      expect(liveShareCardFiles().has(uri)).toBe(true)
      await vi.advanceTimersByTimeAsync(1000)
      expect(cleanup).not.toHaveBeenCalled()
      release()
      await vi.advanceTimersByTimeAsync(1000)
      expect(cleanup).toHaveBeenCalledOnce()
      expect(liveShareCardFiles().has(uri)).toBe(false)
    } finally {
      release()
      vi.useRealTimers()
    }
  })
  it('retries cleanup in-session without reimport and stops after bounded persistent failures', async () => {
    // Mirrors the private retryDelays schedule in share-card-save-operations.ts.
    const automaticRetryDelaysMs = [1000, 5000, 30000]
    const oneDayMs = 86_400_000
    vi.useFakeTimers()
    const save = vi.fn(() => Promise.resolve())
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('persistent disk failure'))
    try {
      await commitShareCardSave({ fileUri: 'cache/cc68-retry-timer.png', save, cleanup })
      expect(cleanup).toHaveBeenCalledTimes(1)
      for (const [retry, delay] of automaticRetryDelaysMs.entries()) {
        await vi.advanceTimersByTimeAsync(delay)
        expect(cleanup).toHaveBeenCalledTimes(retry + 2)
      }
      await vi.advanceTimersByTimeAsync(oneDayMs)
      expect(cleanup).toHaveBeenCalledTimes(automaticRetryDelaysMs.length + 1)
      expect(save).toHaveBeenCalledOnce()
      expect(liveShareCardFiles().has('cache/cc68-retry-timer.png')).toBe(true)
      cleanup.mockResolvedValue(undefined)
      await retryShareCardCleanup()
      expect(liveShareCardFiles().has('cache/cc68-retry-timer.png')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
  it('eventually cleans a transient failure while protecting every reserved live file', async () => {
    vi.useFakeTimers()
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValue(undefined)
    const save = vi.fn(() => Promise.resolve())
    try {
      await commitShareCardSave({ fileUri: 'cache/cc68-live-retry.png', save, cleanup })
      const release = reserveShareCardFile('cache/cc68-live-retry.png')
      await vi.advanceTimersByTimeAsync(1000)
      expect(cleanup).toHaveBeenCalledTimes(1)
      release()
      await vi.advanceTimersByTimeAsync(1000)
      expect(cleanup).toHaveBeenCalledTimes(2)
      expect(save).toHaveBeenCalledOnce()
      expect(liveShareCardFiles().has('cache/cc68-live-retry.png')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
  it('a file being asynchronously cleaned cannot be reserved or committed by another operation', async () => {
    const removal = deferred()
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk'))
      .mockReturnValueOnce(removal.promise)
    await commitShareCardSave({
      fileUri: 'cache/cc68-cleaning.png',
      save: () => Promise.resolve(),
      cleanup,
    })
    const retry = retryShareCardCleanup()
    expect(() => reserveShareCardFile('cache/cc68-cleaning.png')).toThrow('file_busy')
    const save = vi.fn(() => Promise.resolve())
    await expect(
      commitShareCardSave({ fileUri: 'cache/cc68-cleaning.png', save, cleanup })
    ).rejects.toThrow('finishingSave')
    expect(save).not.toHaveBeenCalled()
    removal.resolve()
    await retry
    expect(liveShareCardFiles().has('cache/cc68-cleaning.png')).toBe(false)
  })
})
function deferredValue<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
describe('Story 6.9 one global native operation', () => {
  it('U-SHARE-OPS: a pending share blocks save and another share; the lock releases once', async () => {
    const native = deferredValue<{ outcome: string }>()
    const owner = {}
    const notifications = vi.fn()
    const unsubscribe = subscribeShareCardSave(notifications)
    const share = vi.fn(() => native.promise)
    const shared = commitShareCardShare({
      fileUri: 'cache/cc69-share-a.png',
      owner,
      share,
    })
    try {
      expect(nativeShareCardSavePending()).toBe(true)
      expect(ownsPendingShareCardSave(owner)).toBe(true)
      const save = vi.fn(() => Promise.resolve())
      await expect(
        commitShareCardSave({ fileUri: 'cache/cc68-b.png', save, cleanup: save })
      ).rejects.toThrow('finishingSave')
      const duplicate = vi.fn(() => Promise.resolve({ outcome: 'duplicate' }))
      await expect(
        commitShareCardShare({ fileUri: 'cache/cc69-share-c.png', share: duplicate })
      ).rejects.toThrow('finishingSave')
      expect(save).not.toHaveBeenCalled()
      expect(duplicate).not.toHaveBeenCalled()
      await Promise.resolve()
      expect(share).toHaveBeenCalledOnce()
      native.resolve({ outcome: 'completed' })
      // A late duplicate callback from the bridge cannot settle the operation twice.
      native.resolve({ outcome: 'failed' })
      await expect(shared).resolves.toEqual({ outcome: 'completed' })
      expect(nativeShareCardSavePending()).toBe(false)
      // One notification at commit and exactly one at release.
      expect(notifications).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
    }
  })
  it('U-SHARE-OPS: a pending save blocks a share until it settles', async () => {
    const native = deferred()
    const saving = commitShareCardSave({
      fileUri: 'cache/cc68-first.png',
      save: () => native.promise,
      cleanup: () => Promise.resolve(),
    })
    const share = vi.fn(() => Promise.resolve('completed'))
    await expect(
      commitShareCardShare({ fileUri: 'cache/cc69-share-blocked.png', share })
    ).rejects.toThrow('finishingSave')
    expect(share).not.toHaveBeenCalled()
    native.resolve()
    await saving
    await expect(
      commitShareCardShare({ fileUri: 'cache/cc69-share-after.png', share })
    ).resolves.toBe('completed')
    expect(share).toHaveBeenCalledOnce()
  })
  it('U-SHARE-LEASE: settlement releases the lock and hands the file to its lease', async () => {
    const native = deferredValue<string>()
    const shared = commitShareCardShare({
      fileUri: 'cache/cc69-share-leased.png',
      share: () => native.promise,
    })
    expect(liveShareCardFiles().has('cache/cc69-share-leased.png')).toBe(true)
    native.resolve('target_chosen')
    await shared
    expect(nativeShareCardSavePending()).toBe(false)
    // No cleanup ran or was queued: only the age sweep may remove a leased file.
    expect(liveShareCardFiles().has('cache/cc69-share-leased.png')).toBe(false)
  })
  it('U-SHARE-OPS: a rejected share still releases the lock exactly once', async () => {
    const notifications = vi.fn()
    const unsubscribe = subscribeShareCardSave(notifications)
    try {
      await expect(
        commitShareCardShare({
          fileUri: 'cache/cc69-share-rejected.png',
          share: () => Promise.reject(new Error('bridge')),
        })
      ).rejects.toThrow('bridge')
      expect(nativeShareCardSavePending()).toBe(false)
      expect(notifications).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
    }
  })
})
