// Story 5.1 Task 7 owner: the web commerce preference client.
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  COMMERCE_SIGNED_OUT_MESSAGE,
  CommerceRequestError,
  commerceErrorMessage,
  getCommercePreferenceFromWeb,
  hasWebSession,
  updateCommercePreferenceFromWeb,
} from './commerce'

const PREFERENCES_PATH = '/api/v1/commerce/preferences'

afterEach(() => {
  window.sessionStorage.clear()
})

function signIn(token = 'test-access-token') {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, token)
}

describe('hasWebSession', () => {
  it('5.1-WEB-LIB-01 is false with no token and true with one', () => {
    expect(hasWebSession()).toBe(false)
    signIn()
    expect(hasWebSession()).toBe(true)
  })

  /** A whitespace-only value is a cleared session, not a usable credential. */
  it('5.1-WEB-LIB-02 treats a blank token as signed out', () => {
    signIn('   ')
    expect(hasWebSession()).toBe(false)
  })

  /**
   * Next renders the settings tree on the server first, where there is no
   * `sessionStorage`. Reading it unguarded there would throw during SSR.
   */
  it('5.1-WEB-LIB-02b reports signed out when there is no window', () => {
    signIn()
    vi.stubGlobal('window', undefined)
    try {
      expect(hasWebSession()).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('commerceErrorMessage', () => {
  it('5.1-WEB-LIB-03 prefers the error message and falls back for a non-Error', () => {
    expect(commerceErrorMessage(new Error('boom'), 'fallback')).toBe('boom')
    expect(commerceErrorMessage('boom', 'fallback')).toBe('fallback')
  })
})

describe('getCommercePreferenceFromWeb', () => {
  it('5.1-WEB-LIB-04 reads the preference with a bearer token', async () => {
    signIn()
    const seen = vi.fn<(method: string, authorization: string | null) => void>()
    useMswHandlers(
      http.get(PREFERENCES_PATH, ({ request }) => {
        seen(request.method, request.headers.get('authorization'))
        return HttpResponse.json({ data: { affiliateCtasEnabled: false } })
      })
    )

    await expect(getCommercePreferenceFromWeb()).resolves.toEqual({
      affiliateCtasEnabled: false,
    })
    expect(seen).toHaveBeenCalledWith('GET', 'Bearer test-access-token')
  })

  it('5.1-WEB-LIB-05 refuses to call the API with no session', async () => {
    await expect(getCommercePreferenceFromWeb()).rejects.toThrow(
      COMMERCE_SIGNED_OUT_MESSAGE
    )
  })

  it('5.1-WEB-LIB-06 surfaces the server message', async () => {
    signIn()
    useMswHandlers(
      http.get(PREFERENCES_PATH, () =>
        HttpResponse.json(
          { statusCode: 401, message: 'Unauthorized request', error: 'Unauthorized' },
          { status: 401 }
        )
      )
    )

    await expect(getCommercePreferenceFromWeb()).rejects.toThrow('Unauthorized request')
  })

  it('5.1-WEB-LIB-07 falls back when the failure body carries no message', async () => {
    signIn()
    useMswHandlers(
      http.get(PREFERENCES_PATH, () => HttpResponse.text('gateway down', { status: 502 }))
    )

    await expect(getCommercePreferenceFromWeb()).rejects.toThrow(
      'Unable to load shopping preferences.'
    )
  })

  it('5.1-WEB-LIB-08 falls back when the failure body has a blank message', async () => {
    signIn()
    useMswHandlers(
      http.get(PREFERENCES_PATH, () =>
        HttpResponse.json(
          { statusCode: 500, message: '  ', error: 'Internal Server Error' },
          { status: 500 }
        )
      )
    )

    await expect(getCommercePreferenceFromWeb()).rejects.toThrow(
      'Unable to load shopping preferences.'
    )
  })

  /** Types are not a trust boundary; the contract schema is. */
  it('5.1-WEB-LIB-09 rejects a payload that does not match the contract', async () => {
    signIn()
    useMswHandlers(
      http.get(PREFERENCES_PATH, () =>
        HttpResponse.json({ data: { affiliateCtasEnabled: 'yes' } })
      )
    )

    await expect(getCommercePreferenceFromWeb()).rejects.toBeInstanceOf(
      CommerceRequestError
    )
  })
})

describe('updateCommercePreferenceFromWeb', () => {
  it('5.1-WEB-LIB-10 sends exactly the contract body and returns the stored value', async () => {
    signIn()
    const seen =
      vi.fn<(method: string, body: unknown, contentType: string | null) => void>()
    useMswHandlers(
      http.put(PREFERENCES_PATH, async ({ request }) => {
        seen(
          request.method,
          await request.clone().json(),
          request.headers.get('content-type')
        )
        return HttpResponse.json({ data: { affiliateCtasEnabled: false } })
      })
    )

    await expect(
      updateCommercePreferenceFromWeb({ affiliateCtasEnabled: false })
    ).resolves.toEqual({ affiliateCtasEnabled: false })
    expect(seen).toHaveBeenCalledWith(
      'PUT',
      { affiliateCtasEnabled: false },
      'application/json'
    )
  })

  it('5.1-WEB-LIB-11 refuses to write with no session', async () => {
    await expect(
      updateCommercePreferenceFromWeb({ affiliateCtasEnabled: true })
    ).rejects.toThrow(COMMERCE_SIGNED_OUT_MESSAGE)
  })

  it('5.1-WEB-LIB-12 surfaces the server message on a failed write', async () => {
    signIn()
    useMswHandlers(
      http.put(PREFERENCES_PATH, () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: 'Affiliate suggestions are temporarily unavailable.',
            error: 'Service Unavailable',
          },
          { status: 503 }
        )
      )
    )

    await expect(
      updateCommercePreferenceFromWeb({ affiliateCtasEnabled: false })
    ).rejects.toThrow('Affiliate suggestions are temporarily unavailable.')
  })
})
