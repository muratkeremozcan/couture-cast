// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
import { describe, expect, it, vi } from 'vitest'
import {
  DirectUploadAttemptRegistry,
  DirectUploadAttempts,
  isTerminalUploadStatus,
  runDirectUploadAttempt,
  UPLOAD_BYTES_PRESENT_MESSAGE,
  uploadAttemptEnding,
  UploadSessionChangedError,
  type DirectUploadAttempt,
} from '../src/contracts/http'

type Allocation = { uploadSessionId: string }

class BytesMissing extends Error {}

function steps(
  overrides: {
    commit?: (allocation: Allocation, key: string) => Promise<string>
  } = {}
) {
  return {
    allocate: vi.fn((key: string) =>
      Promise.resolve({ uploadSessionId: `session-for-${key}` })
    ),
    upload: vi.fn((_allocation: Allocation) => Promise.resolve()),
    commit: vi.fn(overrides.commit ?? (() => Promise.resolve('committed'))),
    isBytesMissing: (error: unknown) => error instanceof BytesMissing,
  }
}

function freshAttempt(): DirectUploadAttempt<Allocation> {
  return { allocateKey: 'allocate-key', commitKey: 'commit-key', allocation: null }
}

describe('runDirectUploadAttempt', () => {
  it('allocates, uploads and commits on the first run, keeping the allocation', async () => {
    const attempt = freshAttempt()
    const run = steps()

    await expect(runDirectUploadAttempt(attempt, run)).resolves.toBe('committed')

    expect(run.allocate).toHaveBeenCalledWith('allocate-key')
    expect(run.upload).toHaveBeenCalledWith({
      uploadSessionId: 'session-for-allocate-key',
    })
    expect(run.commit).toHaveBeenCalledWith(
      { uploadSessionId: 'session-for-allocate-key' },
      'commit-key'
    )
    expect(attempt.allocation).toEqual({ uploadSessionId: 'session-for-allocate-key' })
  })

  it('commits first on a retry and never re-uploads or re-allocates when the commit lands', async () => {
    const attempt = freshAttempt()
    attempt.allocation = { uploadSessionId: 'kept-session' }
    const run = steps()

    await expect(runDirectUploadAttempt(attempt, run)).resolves.toBe('committed')

    expect(run.allocate).not.toHaveBeenCalled()
    expect(run.upload).not.toHaveBeenCalled()
    expect(run.commit).toHaveBeenCalledTimes(1)
    expect(run.commit).toHaveBeenCalledWith(
      { uploadSessionId: 'kept-session' },
      'commit-key'
    )
  })

  it('re-uploads and commits again with the same key only when commit reports the bytes missing', async () => {
    const attempt = freshAttempt()
    attempt.allocation = { uploadSessionId: 'kept-session' }
    const commit = vi
      .fn<(allocation: Allocation, key: string) => Promise<string>>()
      .mockRejectedValueOnce(new BytesMissing('UPLOAD_BYTES_MISSING'))
      .mockResolvedValueOnce('committed-after-put')
    const run = steps({ commit })

    await expect(runDirectUploadAttempt(attempt, run)).resolves.toBe(
      'committed-after-put'
    )

    expect(run.allocate).not.toHaveBeenCalled()
    expect(run.upload).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls).toEqual([
      [{ uploadSessionId: 'kept-session' }, 'commit-key'],
      [{ uploadSessionId: 'kept-session' }, 'commit-key'],
    ])
  })

  it('surfaces any other commit failure on a retry without uploading', async () => {
    const attempt = freshAttempt()
    attempt.allocation = { uploadSessionId: 'kept-session' }
    const expired = new Error('UPLOAD_SESSION_EXPIRED')
    const run = steps({ commit: async () => Promise.reject(expired) })

    await expect(runDirectUploadAttempt(attempt, run)).rejects.toBe(expired)
    expect(run.upload).not.toHaveBeenCalled()
  })

  it('keeps the allocation when the upload fails, so the retry commits first', async () => {
    const attempt = freshAttempt()
    const run = steps()
    run.upload.mockRejectedValueOnce(new Error('network down'))

    await expect(runDirectUploadAttempt(attempt, run)).rejects.toThrow('network down')
    expect(attempt.allocation).toEqual({ uploadSessionId: 'session-for-allocate-key' })
    expect(run.commit).not.toHaveBeenCalled()
  })
})

describe('DirectUploadAttempts', () => {
  function counterKeys() {
    let counter = 0
    return () => `k${(counter += 1)}`
  }

  it('returns the same open attempt for the same account and id until it is closed', () => {
    const attempts = new DirectUploadAttempts<Allocation>(counterKeys())

    const first = attempts.open('account-a', 'sha-a')
    expect(attempts.open('account-a', 'sha-a')).toBe(first)
    expect(first).toEqual({ allocateKey: 'k1', commitKey: 'k2', allocation: null })

    attempts.close('account-a', 'sha-a', first)
    expect(attempts.open('account-a', 'sha-a')).toEqual({
      allocateKey: 'k3',
      commitKey: 'k4',
      allocation: null,
    })
  })

  it("never hands one account's attempt to another account picking the same photo", () => {
    const attempts = new DirectUploadAttempts<Allocation>(counterKeys())
    const first = attempts.open('account-a', 'sha-a')
    first.allocation = { uploadSessionId: 'session-of-a' }

    const second = attempts.open('account-b', 'sha-a')

    expect(second).not.toBe(first)
    expect(second).toEqual({ allocateKey: 'k3', commitKey: 'k4', allocation: null })
  })

  it('leaves a newer attempt open when an older one for the same id is closed late', () => {
    const attempts = new DirectUploadAttempts<Allocation>(counterKeys())
    const older = attempts.open('account-a', 'sha-a')
    attempts.clear()
    const newer = attempts.open('account-a', 'sha-a')

    attempts.close('account-a', 'sha-a', older)

    expect(attempts.open('account-a', 'sha-a')).toBe(newer)
  })

  it('forgets the oldest attempt past its bound and keeps nothing for it', () => {
    const attempts = new DirectUploadAttempts<Allocation>(counterKeys(), 2)
    const oldest = attempts.open('account-a', 'a')
    attempts.open('account-a', 'b')
    attempts.open('account-a', 'c')

    expect(attempts.size).toBe(2)
    expect(attempts.open('account-a', 'a')).not.toBe(oldest)
    expect(attempts.size).toBe(2)
  })
})

describe('DirectUploadAttemptRegistry', () => {
  /** A failed step carrying the API's answer, as the platform modules surface it. */
  class Answer extends Error {
    constructor(
      readonly status: number,
      readonly code: string
    ) {
      super(code)
    }
  }

  const classify = {
    isBytesMissing: (error: unknown) =>
      error instanceof Answer && error.code === 'UPLOAD_BYTES_MISSING',
    isTerminal: (error: unknown) =>
      error instanceof Answer && isTerminalUploadStatus(error.status, error.code),
    ending: (error: unknown) =>
      error instanceof Answer ? uploadAttemptEnding(error.status, error.code) : null,
  }

  function setup() {
    let counter = 0
    const registry = new DirectUploadAttemptRegistry()
    const store = registry.createStore<Allocation>(() => `key-${(counter += 1)}`)
    registry.setAccount('account-a')
    return { registry, store }
  }

  function steps(commit: (allocation: Allocation, key: string) => Promise<string>) {
    return {
      allocate: vi.fn((key: string) =>
        Promise.resolve({ uploadSessionId: `session-${key}` })
      ),
      upload: vi.fn((_allocation: Allocation) => Promise.resolve()),
      commit: vi.fn(commit),
    }
  }

  it('keeps the allocation and keys after UPLOAD_IN_PROGRESS, so the retry commits again with them', async () => {
    const { registry, store } = setup()
    const inProgress = new Answer(409, 'UPLOAD_IN_PROGRESS')
    const run = steps(
      vi
        .fn<(allocation: Allocation, key: string) => Promise<string>>()
        .mockRejectedValueOnce(inProgress)
        .mockResolvedValueOnce('replayed')
    )

    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).rejects.toBe(inProgress)
    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).resolves.toBe('replayed')

    expect(run.allocate.mock.calls).toEqual([['key-1']])
    expect(run.upload).toHaveBeenCalledTimes(1)
    expect(run.commit.mock.calls).toEqual([
      [{ uploadSessionId: 'session-key-1' }, 'key-2'],
      [{ uploadSessionId: 'session-key-1' }, 'key-2'],
    ])
  })

  // Coordinator follow-up 1 (round 4): an attempt the server ended for good restarts once on
  // the same Retry, with a fresh allocation and keys, so the member never taps twice.
  it('starts one fresh attempt on the same retry once the server ends the resumed attempt', async () => {
    const { registry, store } = setup()
    const lost = new TypeError('Failed to fetch')
    const expired = new Answer(409, 'UPLOAD_SESSION_EXPIRED')
    const run = steps(
      vi
        .fn<(allocation: Allocation, key: string) => Promise<string>>()
        .mockRejectedValueOnce(lost)
        .mockRejectedValueOnce(expired)
        .mockResolvedValueOnce('committed')
    )

    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).rejects.toBe(lost)
    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).resolves.toBe('committed')

    expect(run.allocate.mock.calls).toEqual([['key-1'], ['key-3']])
    expect(run.upload.mock.calls).toEqual([
      [{ uploadSessionId: 'session-key-1' }],
      [{ uploadSessionId: 'session-key-3' }],
    ])
    expect(run.commit.mock.calls).toEqual([
      [{ uploadSessionId: 'session-key-1' }, 'key-2'],
      [{ uploadSessionId: 'session-key-1' }, 'key-2'],
      [{ uploadSessionId: 'session-key-3' }, 'key-4'],
    ])
    expect(store.size).toBe(0)
  })

  it('restarts at most once: a fresh attempt the server also ends surfaces its answer', async () => {
    const { registry, store } = setup()
    const expired = new Answer(409, 'UPLOAD_SESSION_EXPIRED')
    const run = steps(() => Promise.reject(expired))

    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).rejects.toBe(expired)

    expect(run.allocate.mock.calls).toEqual([['key-1'], ['key-3']])
    expect(run.commit).toHaveBeenCalledTimes(2)
    expect(store.size).toBe(0)
  })

  it('starts over at once when an allocation replay answers UPLOAD_BYTES_PRESENT', async () => {
    const { registry, store } = setup()
    const present = new Answer(409, UPLOAD_BYTES_PRESENT_MESSAGE)
    const run = steps(() => Promise.resolve('committed'))
    run.allocate
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(present)

    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).rejects.toThrow('Failed to fetch')
    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).resolves.toBe('committed')

    // The lost allocation is replayed once with its key; the same retry then starts over.
    expect(run.allocate.mock.calls).toEqual([['key-1'], ['key-1'], ['key-3']])
    expect(run.commit.mock.calls).toEqual([
      [{ uploadSessionId: 'session-key-3' }, 'key-4'],
    ])
  })

  it('restarts a resumed attempt whose staged bytes commit rejected, with this run’s own bytes', async () => {
    const { registry, store } = setup()
    const lost = new TypeError('Failed to fetch')
    const mismatch = new Answer(422, 'IMAGE_CHECKSUM_MISMATCH')
    const run = steps(
      vi
        .fn<(allocation: Allocation, key: string) => Promise<string>>()
        .mockRejectedValueOnce(lost)
        .mockRejectedValueOnce(mismatch)
        .mockResolvedValueOnce('committed')
    )

    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).rejects.toBe(lost)
    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).resolves.toBe('committed')

    expect(run.allocate.mock.calls).toEqual([['key-1'], ['key-3']])
    expect(run.upload).toHaveBeenCalledTimes(2)
  })

  // Round 5 (C4-8): the palette selfie commit refuses resumed bytes with 400, not 422.
  it('restarts a resumed attempt the selfie commit rejected with 400 IMAGE_CHECKSUM_MISMATCH', async () => {
    const { registry, store } = setup()
    const lost = new TypeError('Failed to fetch')
    const mismatch = new Answer(400, 'IMAGE_CHECKSUM_MISMATCH')
    const run = steps(
      vi
        .fn<(allocation: Allocation, key: string) => Promise<string>>()
        .mockRejectedValueOnce(lost)
        .mockRejectedValueOnce(mismatch)
        .mockResolvedValueOnce('committed')
    )

    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).rejects.toBe(lost)
    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).resolves.toBe('committed')

    expect(run.allocate.mock.calls).toEqual([['key-1'], ['key-3']])
    expect(run.upload).toHaveBeenCalledTimes(2)
    expect(run.commit.mock.calls).toEqual([
      [{ uploadSessionId: 'session-key-1' }, 'key-2'],
      [{ uploadSessionId: 'session-key-1' }, 'key-2'],
      [{ uploadSessionId: 'session-key-3' }, 'key-4'],
    ])
  })

  it('surfaces a first-run 400 IMAGE_CHECKSUM_MISMATCH without a restart', async () => {
    const { registry, store } = setup()
    const mismatch = new Answer(400, 'IMAGE_CHECKSUM_MISMATCH')
    const run = steps(() => Promise.reject(mismatch))

    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).rejects.toBe(mismatch)

    expect(run.allocate.mock.calls).toEqual([['key-1']])
    expect(run.upload).toHaveBeenCalledTimes(1)
    expect(store.size).toBe(0)
  })

  it('does not restart a rejection of the bytes the same run just uploaded', async () => {
    const { registry, store } = setup()
    const mismatch = new Answer(422, 'IMAGE_CHECKSUM_MISMATCH')
    const run = steps(() => Promise.reject(mismatch))

    await expect(
      registry.run(store, registry.session(), 'photo', run, classify)
    ).rejects.toBe(mismatch)

    expect(run.allocate.mock.calls).toEqual([['key-1']])
    expect(run.upload).toHaveBeenCalledTimes(1)
    expect(store.size).toBe(0)
  })

  it.each([
    [409, 'UPLOAD_SESSION_EXPIRED', 'session'],
    [404, 'UPLOAD_SESSION_NOT_FOUND', 'session'],
    [409, 'UPLOAD_ALREADY_CLAIMED', 'session'],
    [409, 'IDEMPOTENCY_KEY_REUSED', 'session'],
    [409, UPLOAD_BYTES_PRESENT_MESSAGE, 'session'],
    [415, 'UNSUPPORTED_IMAGE_TYPE', 'rejected'],
    [422, 'IMAGE_DIMENSIONS_INVALID', 'rejected'],
    // Round 5 (C4-8): the palette selfie commit answers its image refusals with 400.
    [400, 'IMAGE_CHECKSUM_MISMATCH', 'rejected'],
    [400, 'IMAGE_DIMENSIONS_INVALID', 'rejected'],
    [400, 'IMAGE_DECODE_FAILED', 'rejected'],
    // Any other 400 is no image rejection: a declaration fault a fresh attempt cannot fix.
    [400, 'INVALID_UPLOAD_DECLARATION', null],
    [400, 'IMAGE_NOT_PORTRAIT_FRAMED', null],
    [400, null, null],
    [409, 'UPLOAD_IN_PROGRESS', null],
    [409, 'UPLOAD_BYTES_MISSING', null],
    [403, 'GUARDIAN_CONSENT_REQUIRED', null],
    [503, 'STORAGE_UNAVAILABLE', null],
  ] as const)('classifies %s %s as ending %s', (status, code, ending) => {
    expect(uploadAttemptEnding(status, code)).toBe(ending)
  })

  it('fences an allocation that answers after the account changed and keeps nothing from it', async () => {
    const { registry, store } = setup()
    let answerAllocation: (allocation: Allocation) => void = () => undefined
    const firstRun = steps(() => Promise.resolve('committed-for-a'))
    firstRun.allocate.mockImplementationOnce(
      () =>
        new Promise<Allocation>((resolve) => {
          answerAllocation = resolve
        })
    )
    const sessionA = registry.session()
    const pending = registry.run(store, sessionA, 'photo', firstRun, classify)

    registry.setAccount('account-b')
    answerAllocation({ uploadSessionId: 'session-of-a' })

    await expect(pending).rejects.toBeInstanceOf(UploadSessionChangedError)
    expect(firstRun.upload).not.toHaveBeenCalled()
    expect(firstRun.commit).not.toHaveBeenCalled()

    const secondRun = steps(() => Promise.resolve('committed-for-b'))
    await expect(
      registry.run(store, registry.session(), 'photo', secondRun, classify)
    ).resolves.toBe('committed-for-b')
    expect(secondRun.allocate.mock.calls).toEqual([['key-3']])
    expect(secondRun.commit.mock.calls).toEqual([
      [{ uploadSessionId: 'session-key-3' }, 'key-4'],
    ])
  })

  it('refuses to start a run whose session is already stale', async () => {
    const { registry, store } = setup()
    const stale = registry.session()
    registry.setAccount(null)
    const run = steps(() => Promise.resolve('committed'))

    await expect(
      registry.run(store, stale, 'photo', run, classify)
    ).rejects.toBeInstanceOf(UploadSessionChangedError)
    expect(run.allocate).not.toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  // Round 5 (C4-1): a photo is bound to the session captured when its picker opened.
  describe('account epoch', () => {
    it('resolves the bearer for the captured account while it is still signed in', async () => {
      const { registry } = setup()
      const read = vi.fn(() => Promise.resolve('token-a'))

      await expect(registry.bearerFor(registry.session(), read)).resolves.toBe('token-a')
      expect(read).toHaveBeenCalledOnce()
    })

    it('refuses before reading a bearer once another account signed in', async () => {
      const { registry } = setup()
      const pickedUnderA = registry.session()
      registry.setAccount('account-b')
      const read = vi.fn(() => 'token-b')

      await expect(registry.bearerFor(pickedUnderA, read)).rejects.toBeInstanceOf(
        UploadSessionChangedError
      )
      expect(read).not.toHaveBeenCalled()
    })

    it('refuses a bearer whose resolution switched the account', async () => {
      const { registry } = setup()
      const pickedUnderA = registry.session()

      await expect(
        registry.bearerFor(pickedUnderA, () => {
          // Resolving the token is where a client notices the stored session is B's now.
          registry.setAccount('account-b')
          return 'token-b'
        })
      ).rejects.toBeInstanceOf(UploadSessionChangedError)
    })

    it('tells subscribers about every account change and sign-out, and nothing when the account is unchanged', () => {
      const { registry } = setup()
      const listener = vi.fn()
      const unsubscribe = registry.subscribe(listener)

      registry.setAccount('account-a')
      expect(listener).not.toHaveBeenCalled()
      registry.setAccount('account-b')
      registry.forgetAll()
      expect(listener).toHaveBeenCalledTimes(2)

      unsubscribe()
      registry.setAccount(null)
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('reads a session as current only for the same account and epoch', () => {
      const { registry } = setup()
      const session = registry.session()
      expect(registry.isCurrent(session)).toBe(true)
      expect(registry.isCurrent({ ...session, account: 'account-b' })).toBe(false)

      registry.forgetAll()
      expect(registry.isCurrent(session)).toBe(false)
    })
  })

  it('forgets every open attempt of every store on an account change, and keeps them when the account is unchanged', async () => {
    const { registry, store } = setup()
    const other = registry.createStore<Allocation>(() => 'other-key')
    const unavailable = new Answer(503, 'Service Unavailable')
    const failing = steps(() => Promise.reject(unavailable))

    await expect(
      registry.run(store, registry.session(), 'photo', failing, classify)
    ).rejects.toBe(unavailable)
    await expect(
      registry.run(other, registry.session(), 'photo', failing, classify)
    ).rejects.toBe(unavailable)
    registry.setAccount('account-a')
    expect([store.size, other.size]).toEqual([1, 1])

    registry.setAccount('account-b')
    expect([store.size, other.size]).toEqual([0, 0])
  })
})

describe('isTerminalUploadStatus', () => {
  it.each([
    [400, undefined, true],
    [404, undefined, true],
    [409, undefined, true],
    [415, undefined, true],
    [422, undefined, true],
    [401, undefined, false],
    [408, undefined, false],
    [429, undefined, false],
    [500, undefined, false],
    [503, undefined, false],
    [null, undefined, false],
    [undefined, undefined, false],
    [409, 'UPLOAD_IN_PROGRESS', false],
    [409, UPLOAD_BYTES_PRESENT_MESSAGE, true],
    [409, 'UPLOAD_SESSION_EXPIRED', true],
    [409, 'IDEMPOTENCY_KEY_REUSED', true],
    [409, 'UPLOAD_BYTES_MISSING', true],
    // Round 5 (C4-8): the selfie's 400 image refusals end the attempt, as uploadAttemptEnding
    // reads them.
    [400, 'IMAGE_CHECKSUM_MISMATCH', true],
    [400, 'IMAGE_DIMENSIONS_INVALID', true],
    [400, 'IMAGE_DECODE_FAILED', true],
  ])('status %s with code %s is terminal: %s', (status, code, terminal) => {
    expect(isTerminalUploadStatus(status, code)).toBe(terminal)
  })
})
