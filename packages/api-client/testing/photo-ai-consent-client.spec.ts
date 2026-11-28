// Learning path Step 81: Photo AI consent and processor approval.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-81-photo-ai-consent-and-processor-approval
import { describe, expect, it, vi } from 'vitest'
import { Configuration, DefaultApi } from '../src/generated'
import { requestPhotoAiConsent } from '../src/photo-ai-consent-client'

const URL = 'https://api.invalid/api/v1/privacy/photo-ai-consent'
const OFF = { externalProcessingEnabled: false, grants: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function client() {
  const fetchApi = vi.fn<typeof fetch>()
  const api = new DefaultApi(
    new Configuration({
      basePath: 'https://api.invalid',
      accessToken: 'synthetic-member-bearer',
      fetchApi,
    })
  )
  return { api, fetchApi }
}

describe('CC-7.24 photo AI consent SDK', () => {
  it('reads and revokes with a bearer and keeps the grant identifier in the JSON body', async () => {
    const { api, fetchApi } = client()
    const { signal } = new AbortController()
    fetchApi.mockImplementation(() => Promise.resolve(Response.json({ data: OFF })))

    await expect(requestPhotoAiConsent(api, signal)).resolves.toEqual(OFF)
    await expect(requestPhotoAiConsent(api, signal, 'synthetic-grant')).resolves.toEqual(
      OFF
    )

    expect(
      fetchApi.mock.calls.map(([url, init]) => [url, init?.method, init?.body])
    ).toEqual([
      [URL, 'GET', undefined],
      [`${URL}/revoke`, 'POST', JSON.stringify({ grantId: 'synthetic-grant' })],
    ])
    for (const [, init] of fetchApi.mock.calls) {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer synthetic-member-bearer'
      )
    }
  })

  it('rejects an enabled response while the launch policy is disabled', async () => {
    const { api, fetchApi } = client()
    fetchApi.mockResolvedValueOnce(
      Response.json({
        data: { externalProcessingEnabled: true, grants: [] },
      })
    )

    await expect(
      requestPhotoAiConsent(api, new AbortController().signal)
    ).rejects.toMatchObject({
      name: 'ZodError',
    })
  })

  it('forwards cancellation to an in-flight authenticated read', async () => {
    const { api, fetchApi } = client()
    const caller = new AbortController()
    const received = deferred<AbortSignal>()
    fetchApi.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init!.signal!
          signal.addEventListener('abort', () => reject(new Error('Request aborted')), {
            once: true,
          })
          received.resolve(signal)
        })
    )

    const read = requestPhotoAiConsent(api, caller.signal)
    const rejected = expect(read).rejects.toBeInstanceOf(Error)
    const signal = await received.promise
    caller.abort()

    expect(signal.aborted).toBe(true)
    await rejected
  })
})
