// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResponseError } from '@couture/api-client'
import { UploadSessionChangedError } from '@couture/api-client/contracts/http'

import { setMobileApplicationUserId } from './mobile-auth'
import {
  createUploadAttempts,
  currentUploadSession,
  forgetAllUploadAttempts,
  isTerminalUploadFailure,
  readUploadFailure,
  resolveUploadBearer,
  runTrackedUpload as runTrackedUploadInSession,
  throwUploadStepError,
  uploadFailureEnding,
} from './upload-attempts'

afterEach(() => {
  setMobileApplicationUserId(null)
  forgetAllUploadAttempts()
})

/** A run under the session current at the call, as a flow takes it with its bearer token. */
function runTrackedUpload<TAllocation, TResult>(
  ...[store, id, steps]: [
    Parameters<typeof runTrackedUploadInSession<TAllocation, TResult>>[0],
    string,
    Parameters<typeof runTrackedUploadInSession<TAllocation, TResult>>[3],
  ]
) {
  return runTrackedUploadInSession(store, currentUploadSession(), id, steps)
}

type Allocation = { uploadSessionId: string }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A failed step as a flow surfaces it: its own error, with the answer remembered on it. */
async function surfacedFailure(status: number, message: string): Promise<Error> {
  const response = jsonResponse(status, { statusCode: status, message, error: 'Error' })
  return throwUploadStepError(response, () =>
    Promise.resolve(new Error(`flow: ${message}`))
  ).then(
    () => expect.unreachable('throwUploadStepError always throws'),
    (error: unknown) => error as Error
  )
}

describe('readUploadFailure', () => {
  it("reads the status and the API's code from a failed fetch Response", async () => {
    await expect(
      readUploadFailure(
        jsonResponse(409, { statusCode: 409, message: 'UPLOAD_BYTES_MISSING' })
      )
    ).resolves.toEqual({ status: 409, code: 'UPLOAD_BYTES_MISSING' })
  })

  it('reads a ResponseError from the generated client and leaves its body readable', async () => {
    const response = jsonResponse(409, { error: { code: 'UPLOAD_SESSION_EXPIRED' } })
    const raw = new ResponseError(response, 'Response returned an error code')

    await expect(readUploadFailure(raw)).resolves.toEqual({
      status: 409,
      code: 'UPLOAD_SESSION_EXPIRED',
    })
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UPLOAD_SESSION_EXPIRED' },
    })
  })

  it('returns null for a network fault and a code of null for a body that is not JSON', async () => {
    await expect(readUploadFailure(new TypeError('Failed to fetch'))).resolves.toBeNull()
    await expect(readUploadFailure(new Response(null, { status: 503 }))).resolves.toEqual(
      {
        status: 503,
        code: null,
      }
    )
  })
})

describe('isTerminalUploadFailure', () => {
  it.each([
    [409, 'UPLOAD_SESSION_EXPIRED', true],
    [404, 'UPLOAD_SESSION_NOT_FOUND', true],
    [409, 'IDEMPOTENCY_KEY_REUSED', true],
    [409, 'UPLOAD_BYTES_PRESENT', true],
    [409, 'UPLOAD_IN_PROGRESS', false],
    [422, 'IMAGE_CHECKSUM_MISMATCH', true],
    [401, 'Unauthorized', false],
    [503, 'Service Unavailable', false],
  ])('a %s %s answer is terminal: %s', async (status, message, terminal) => {
    expect(isTerminalUploadFailure(await surfacedFailure(status, message))).toBe(terminal)
  })

  it('keeps an attempt open for an error that carries no answer', () => {
    expect(isTerminalUploadFailure(new Error('network down'))).toBe(false)
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

describe('runTrackedUpload', () => {
  function steps(commit: (allocation: Allocation, key: string) => Promise<string>) {
    return {
      allocate: vi.fn((key: string) =>
        Promise.resolve({ uploadSessionId: `session-${key}` })
      ),
      upload: vi.fn(() => Promise.resolve()),
      commit: vi.fn(commit),
    }
  }

  it('re-uploads on a retry only when commit reports the bytes missing', async () => {
    const store = createUploadAttempts<Allocation>()
    const missing = await surfacedFailure(409, 'UPLOAD_BYTES_MISSING')
    const unavailable = await surfacedFailure(503, 'Service Unavailable')
    const commit = vi
      .fn<(allocation: Allocation, key: string) => Promise<string>>()
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce('committed')
    const run = steps(commit)

    await expect(runTrackedUpload(store, 'photo-a', run)).rejects.toBe(unavailable)
    await expect(runTrackedUpload(store, 'photo-a', run)).resolves.toBe('committed')

    expect(run.allocate).toHaveBeenCalledTimes(1)
    expect(run.upload).toHaveBeenCalledTimes(2)
    const allocateKey = run.allocate.mock.calls[0]?.[0]
    const [first, second, third] = commit.mock.calls
    expect(first?.[0]).toEqual({ uploadSessionId: `session-${allocateKey}` })
    expect([second, third]).toEqual([first, first])
  })

  it('starts one fresh attempt in the same run after the server ended the first, then forgets it', async () => {
    const store = createUploadAttempts<Allocation>()
    const expired = await surfacedFailure(409, 'UPLOAD_SESSION_EXPIRED')
    const commit = vi
      .fn<(allocation: Allocation, key: string) => Promise<string>>()
      .mockRejectedValueOnce(expired)
      .mockResolvedValueOnce('committed')
    const run = steps(commit)

    await expect(runTrackedUpload(store, 'photo-a', run)).resolves.toBe('committed')

    expect(run.allocate).toHaveBeenCalledTimes(2)
    expect(run.upload).toHaveBeenCalledTimes(2)
    const firstKey = run.allocate.mock.calls[0]?.[0]
    const freshKey = run.allocate.mock.calls[1]?.[0]
    expect(freshKey).not.toBe(firstKey)
    expect(commit.mock.calls[1]?.[0]).toEqual({ uploadSessionId: `session-${freshKey}` })
    expect(commit.mock.calls[1]?.[1]).not.toBe(commit.mock.calls[0]?.[1])
    expect(store.size).toBe(0)
  })

  it('forgets the attempt after a success and after forgetAllUploadAttempts', async () => {
    const store = createUploadAttempts<Allocation>()
    const unavailable = await surfacedFailure(503, 'Service Unavailable')
    const run = steps(
      vi
        .fn<(allocation: Allocation, key: string) => Promise<string>>()
        .mockResolvedValueOnce('first')
        .mockRejectedValueOnce(unavailable)
        .mockResolvedValueOnce('third')
    )

    await expect(runTrackedUpload(store, 'photo-a', run)).resolves.toBe('first')
    await expect(runTrackedUpload(store, 'photo-a', run)).rejects.toBe(unavailable)
    forgetAllUploadAttempts()
    await expect(runTrackedUpload(store, 'photo-a', run)).resolves.toBe('third')

    expect(run.allocate).toHaveBeenCalledTimes(3)
    expect(new Set(run.allocate.mock.calls.map(([key]) => key)).size).toBe(3)
  })
})

describe('upload attempts follow the signed-in account', () => {
  type Seen = { allocateKeys: string[]; uploads: number }

  function failingUploadSteps(seen: Seen) {
    return {
      allocate: (key: string) => {
        seen.allocateKeys.push(key)
        return Promise.resolve({ uploadSessionId: `session-${key}` })
      },
      upload: () => {
        seen.uploads += 1
        return Promise.reject(new TypeError('Network request failed'))
      },
      commit: () => Promise.resolve('unreached'),
    }
  }

  it('forgets every open attempt when the identity changes, and keeps it while it does not', async () => {
    const store = createUploadAttempts<Allocation>()
    setMobileApplicationUserId('member-a')
    const seen: Seen = { allocateKeys: [], uploads: 0 }

    await expect(
      runTrackedUpload(store, 'photo', failingUploadSteps(seen))
    ).rejects.toThrow('Network request failed')
    setMobileApplicationUserId('member-a')
    expect(store.size).toBe(1)

    // An auth state change to another member, with no explicit sign-out.
    setMobileApplicationUserId('member-b')
    expect(store.size).toBe(0)
    await expect(
      runTrackedUpload(store, 'photo', failingUploadSteps(seen))
    ).rejects.toThrow('Network request failed')
    expect(seen.allocateKeys).toHaveLength(2)
    expect(seen.allocateKeys[1]).not.toBe(seen.allocateKeys[0])
  })

  it('fences an allocation that answers after the identity changed and keeps nothing from it', async () => {
    const store = createUploadAttempts<Allocation>()
    setMobileApplicationUserId('member-a')
    let answer: (allocation: Allocation) => void = () => undefined
    const upload = vi.fn(() => Promise.resolve())
    const underWay = runTrackedUpload(store, 'photo', {
      allocate: () =>
        new Promise<Allocation>((resolve) => {
          answer = resolve
        }),
      upload,
      commit: () => Promise.resolve('unreached'),
    })

    setMobileApplicationUserId(null)
    answer({ uploadSessionId: 'late-session-of-a' })

    await expect(underWay).rejects.toMatchObject({ name: 'UploadSessionChangedError' })
    expect(upload).not.toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  // Round 5 (C4-1): the bearer is resolved for the account the photo was picked under.
  it('resolves the bearer only while the captured account is still signed in', async () => {
    setMobileApplicationUserId('member-a')
    const pickedUnderA = currentUploadSession()
    await expect(resolveUploadBearer(pickedUnderA, () => 'token-a')).resolves.toBe(
      'token-a'
    )

    setMobileApplicationUserId('member-b')
    const read = vi.fn(() => 'token-b')
    await expect(resolveUploadBearer(pickedUnderA, read)).rejects.toBeInstanceOf(
      UploadSessionChangedError
    )
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a bearer whose resolution found another account signed in', async () => {
    setMobileApplicationUserId('member-a')
    const pickedUnderA = currentUploadSession()

    await expect(
      resolveUploadBearer(pickedUnderA, () => {
        setMobileApplicationUserId('member-b')
        return 'token-b'
      })
    ).rejects.toBeInstanceOf(UploadSessionChangedError)
  })
})
