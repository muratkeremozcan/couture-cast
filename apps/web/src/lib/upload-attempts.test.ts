// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '@couture/api-client'
import { UploadSessionChangedError } from '@couture/api-client/contracts/http'
import {
  createUploadAttempts,
  currentUploadSession,
  forgetAllUploadAttempts,
  isTerminalUploadFailure,
  resolveUploadBearer,
  runTrackedUpload,
  setUploadAttemptAccount,
  throwUploadStepError,
  uploadFailureEnding,
} from './upload-attempts'

type Allocation = { uploadSessionId: string }

afterEach(() => {
  setUploadAttemptAccount(null)
  forgetAllUploadAttempts()
})

/** A failed generated-client call as a flow surfaces it: its own error, answer remembered. */
async function surfacedFailure(status: number, message: string): Promise<Error> {
  const response = new Response(JSON.stringify({ statusCode: status, message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return throwUploadStepError(new ResponseError(response, 'failed'), () =>
    Promise.resolve(new Error(`flow: ${message}`))
  ).then(
    () => expect.unreachable('throwUploadStepError always throws'),
    (error: unknown) => error as Error
  )
}

function steps() {
  return {
    allocate: vi.fn((key: string) =>
      Promise.resolve({ uploadSessionId: `session-${key}` })
    ),
    upload: vi
      .fn<(allocation: Allocation) => Promise<void>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(undefined),
    commit: vi.fn((allocation: Allocation) =>
      Promise.resolve(allocation.uploadSessionId)
    ),
  }
}

describe('isTerminalUploadFailure', () => {
  it.each([
    [409, 'UPLOAD_SESSION_EXPIRED', true],
    [409, 'UPLOAD_BYTES_PRESENT', true],
    [422, 'IMAGE_CHECKSUM_MISMATCH', true],
    [409, 'UPLOAD_IN_PROGRESS', false],
    [503, 'Service Unavailable', false],
  ])('a %s %s answer is terminal: %s', async (status, message, terminal) => {
    expect(isTerminalUploadFailure(await surfacedFailure(status, message))).toBe(terminal)
  })

  it('shows UPLOAD_IN_PROGRESS as a retryable message', async () => {
    expect((await surfacedFailure(409, 'UPLOAD_IN_PROGRESS')).message).toBe(
      'This photo is still being saved. Try again in a moment.'
    )
  })
})

describe('uploadFailureEnding', () => {
  it.each([
    [409, 'UPLOAD_SESSION_EXPIRED', 'session'],
    [404, 'UPLOAD_SESSION_NOT_FOUND', 'session'],
    [409, 'UPLOAD_ALREADY_CLAIMED', 'session'],
    [409, 'IDEMPOTENCY_KEY_REUSED', 'session'],
    [409, 'UPLOAD_BYTES_PRESENT', 'session'],
    [415, 'Unsupported Media Type', 'rejected'],
    [422, 'IMAGE_CHECKSUM_MISMATCH', 'rejected'],
    // Round 5 (C4-8): the palette selfie commit refuses stored bytes with 400.
    [400, 'IMAGE_CHECKSUM_MISMATCH', 'rejected'],
    [400, 'IMAGE_DIMENSIONS_INVALID', 'rejected'],
    [400, 'IMAGE_DECODE_FAILED', 'rejected'],
    [400, 'INVALID_UPLOAD_DECLARATION', null],
    [422, 'VALIDATION_FAILED', null],
    [409, 'UPLOAD_IN_PROGRESS', null],
    [409, 'UPLOAD_BYTES_MISSING', null],
    [503, 'Service Unavailable', null],
  ])('a %s %s answer ends the attempt as: %s', async (status, message, ending) => {
    expect(uploadFailureEnding(await surfacedFailure(status, message))).toBe(ending)
  })

  it('reads no ending from an error that carries no answer', () => {
    expect(uploadFailureEnding(new TypeError('Failed to fetch'))).toBeNull()
  })
})

describe('upload attempts follow the signed-in account', () => {
  /** An open attempt belongs to the account that allocated it; sign-out forgets it. */
  it('forgetAllUploadAttempts closes an attempt a network fault left open', async () => {
    let counter = 0
    const store = createUploadAttempts<Allocation>(() => `key-${(counter += 1)}`)
    const run = steps()

    await expect(
      runTrackedUpload(store, currentUploadSession(), 'photo', run)
    ).rejects.toThrow('Failed to fetch')
    forgetAllUploadAttempts()

    await expect(
      runTrackedUpload(store, currentUploadSession(), 'photo', run)
    ).resolves.toBe('session-key-3')
    expect(run.allocate.mock.calls).toEqual([['key-1'], ['key-3']])
  })

  it('keeps the open attempt while the account stays the same and forgets it when it changes', async () => {
    let counter = 0
    const store = createUploadAttempts<Allocation>(() => `key-${(counter += 1)}`)
    setUploadAttemptAccount('account-a')
    const run = steps()

    await expect(
      runTrackedUpload(store, currentUploadSession(), 'photo', run)
    ).rejects.toThrow('Failed to fetch')
    setUploadAttemptAccount('account-a')
    expect(store.size).toBe(1)

    setUploadAttemptAccount('account-b')
    expect(store.size).toBe(0)
    const fresh = await runTrackedUpload(store, currentUploadSession(), 'photo', run)

    expect(fresh).toBe('session-key-3')
  })

  it('refuses a run whose session was taken before the account changed', async () => {
    const store = createUploadAttempts<Allocation>(() => 'unused')
    const taken = currentUploadSession()
    setUploadAttemptAccount('account-c')
    const run = steps()

    await expect(runTrackedUpload(store, taken, 'photo', run)).rejects.toBeInstanceOf(
      UploadSessionChangedError
    )
    expect(run.allocate).not.toHaveBeenCalled()
  })

  // Round 5 (C4-1): the bearer is resolved for the account the photo was picked under.
  it('resolves the bearer only while the captured account is still signed in', async () => {
    setUploadAttemptAccount('member-a')
    const pickedUnderA = currentUploadSession()
    await expect(resolveUploadBearer(pickedUnderA, () => 'token-a')).resolves.toBe(
      'token-a'
    )

    setUploadAttemptAccount('member-b')
    const read = vi.fn(() => 'token-b')
    await expect(resolveUploadBearer(pickedUnderA, read)).rejects.toBeInstanceOf(
      UploadSessionChangedError
    )
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a bearer whose resolution found another account signed in', async () => {
    setUploadAttemptAccount('member-a')
    const pickedUnderA = currentUploadSession()

    await expect(
      resolveUploadBearer(pickedUnderA, () => {
        setUploadAttemptAccount('member-b')
        return 'token-b'
      })
    ).rejects.toBeInstanceOf(UploadSessionChangedError)
  })
})
