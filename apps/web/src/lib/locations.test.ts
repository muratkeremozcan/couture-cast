// Learning path Step 45: Client location capture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-45-client-location-capture
// Story 1.2b: the web location transport. Every failure reaches the UI as one
// `LocationFailureReason`, so this pins the mapping from each HTTP answer.
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  LocationSearchCandidate,
  SavedLocation,
} from '@couture/api-client/contracts/http'
import { useMswHandlers } from '../test-utils/msw/runtime'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import {
  deleteLocationFromWeb,
  listLocationsFromWeb,
  LocationRequestError,
  renameLocationFromWeb,
  saveLocationFromSearchFromWeb,
  searchLocationsFromWeb,
  setPrimaryLocationFromWeb,
} from './locations'

const location: SavedLocation = {
  id: 'loc-1',
  label: 'Home',
  locationKey: 'chicago-illinois-us-41-878n-87-630w',
  latitude: 41.878,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  isPrimary: true,
  sortOrder: 0,
  createdAt: '2026-10-22T12:00:00.000Z',
  updatedAt: '2026-10-22T12:00:00.000Z',
}

const candidate: LocationSearchCandidate = {
  city: 'Chicago',
  region: 'Illinois',
  country: 'US',
  latitude: 41.878,
  longitude: -87.63,
  displayLabel: 'Chicago, Illinois, United States',
  candidateToken: 'payload.signature',
}

afterEach(() => {
  window.sessionStorage.clear()
})

function signIn() {
  window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'test-access-token')
}

async function reasonOf(work: Promise<unknown>): Promise<string> {
  const caught = await work.catch((error: unknown) => error)
  expect(caught).toBeInstanceOf(LocationRequestError)
  return (caught as LocationRequestError).reason
}

/** The 400 envelope the location routes answer with a typed `code`. */
function requestErrorBody(code: string) {
  return { statusCode: 400, code, message: 'x', error: 'Bad Request' }
}

/** The retryable 503 envelope the location routes answer with a typed `code`. */
function unavailableBody(code: string) {
  return {
    statusCode: 503,
    code,
    retryable: true,
    message: 'x',
    error: 'Service Unavailable',
  }
}

type SentRequest = {
  method: string
  path: string
  body: unknown
  platform: string | null
  authorization: string | null
}

/** Answers every location route with `answer` and records what each request sent. */
function useLocationRequestRecorder(
  answer: () => Response = () => HttpResponse.json({})
) {
  const sent: SentRequest[] = []
  useMswHandlers(
    http.all('*/api/v1/locations*', async ({ request }) => {
      const url = new URL(request.url)
      const text = await request.text()
      sent.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        body: text ? (JSON.parse(text) as unknown) : null,
        platform: request.headers.get('x-couture-platform'),
        authorization: request.headers.get('authorization'),
      })
      return answer()
    })
  )
  return sent
}

/** A promise the test settles itself, so no timer decides when a handler answers. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => (resolve = settle))
  return { promise, resolve }
}

const everyCall = [
  ['listLocationsFromWeb', () => listLocationsFromWeb()],
  ['searchLocationsFromWeb', () => searchLocationsFromWeb('Chicago', 'en-US')],
  [
    'saveLocationFromSearchFromWeb',
    () => saveLocationFromSearchFromWeb('payload.signature', 'Home'),
  ],
  ['setPrimaryLocationFromWeb', () => setPrimaryLocationFromWeb('loc-1')],
  ['renameLocationFromWeb', () => renameLocationFromWeb('loc-1', 'Office')],
  ['deleteLocationFromWeb', () => deleteLocationFromWeb('loc-1')],
] as const

describe('web location transport', () => {
  it.each(everyCall)(
    '1.2b-WEB-LIB-01 %s refuses while signed out, before any request',
    async (_name, call) => {
      const sent = useLocationRequestRecorder()

      await expect(reasonOf(call())).resolves.toBe('signed_out')
      expect(sent).toEqual([])
    }
  )

  it.each([
    {
      name: 'listLocationsFromWeb',
      call: () => listLocationsFromWeb(),
      status: 200,
      answer: { data: [location] },
      result: [location],
      request: { method: 'GET', path: '/api/v1/locations', body: null, platform: null },
    },
    {
      name: 'searchLocationsFromWeb',
      call: () => searchLocationsFromWeb('Chicago', 'en-US'),
      status: 200,
      answer: { data: [candidate] },
      result: [candidate],
      request: {
        method: 'GET',
        path: '/api/v1/locations/search?q=Chicago&locale=en-US',
        body: null,
        platform: 'web',
      },
    },
    {
      name: 'saveLocationFromSearchFromWeb',
      call: () => saveLocationFromSearchFromWeb('payload.signature', 'Home'),
      status: 201,
      answer: { data: location },
      result: location,
      request: {
        method: 'POST',
        path: '/api/v1/locations/from-search',
        body: { candidateToken: 'payload.signature', label: 'Home' },
        platform: 'web',
      },
    },
    {
      name: 'setPrimaryLocationFromWeb',
      call: () => setPrimaryLocationFromWeb('loc-1'),
      status: 200,
      answer: { data: location },
      result: location,
      request: {
        method: 'POST',
        path: '/api/v1/locations/loc-1/primary',
        body: null,
        platform: null,
      },
    },
    {
      name: 'renameLocationFromWeb',
      call: () => renameLocationFromWeb('loc-1', 'Office'),
      status: 200,
      answer: { data: { ...location, label: 'Office' } },
      result: { ...location, label: 'Office' },
      request: {
        method: 'PATCH',
        path: '/api/v1/locations/loc-1',
        body: { label: 'Office' },
        platform: null,
      },
    },
    {
      name: 'deleteLocationFromWeb',
      call: () => deleteLocationFromWeb('loc-1'),
      status: 200,
      answer: { data: { deleted: true } },
      result: undefined,
      request: {
        method: 'DELETE',
        path: '/api/v1/locations/loc-1',
        body: null,
        platform: null,
      },
    },
  ])(
    '1.2b-WEB-LIB-02 $name sends its request and parses the success',
    async ({ call, status, answer, result, request }) => {
      signIn()
      const sent = useLocationRequestRecorder(() => HttpResponse.json(answer, { status }))

      await expect(call()).resolves.toEqual(result)
      expect(sent).toEqual([{ ...request, authorization: 'Bearer test-access-token' }])
    }
  )

  it.each([
    [401, { message: 'Unauthorized' }, 'signed_out'],
    [404, { message: 'Not Found' }, 'not_found'],
    [429, { message: 'Too Many Requests' }, 'rate_limited'],
    [400, requestErrorBody('invalid_request'), 'invalid_query'],
    [400, requestErrorBody('invalid_candidate'), 'invalid_candidate'],
    [400, requestErrorBody('location_limit_reached'), 'limit_reached'],
    [400, requestErrorBody('location_duplicate'), 'duplicate'],
    [503, unavailableBody('provider_unavailable'), 'provider_unavailable'],
    [503, unavailableBody('location_service_unavailable'), 'service_unavailable'],
    // The legacy location routes answer the plain Nest 400.
    [400, { statusCode: 400, message: 'bad', error: 'Bad Request' }, 'invalid_query'],
    [500, { statusCode: 500, message: 'boom' }, 'unknown'],
  ])('1.2b-WEB-LIB-03 maps HTTP %i %j to %s', async (status, body, reason) => {
    signIn()
    useMswHandlers(
      http.post('*/api/v1/locations/from-search', () =>
        HttpResponse.json(body, { status })
      )
    )

    await expect(
      reasonOf(saveLocationFromSearchFromWeb('payload.signature', 'Home'))
    ).resolves.toBe(reason)
  })

  it('1.2b-WEB-LIB-04 maps a body that is not JSON and a dropped connection to unknown', async () => {
    signIn()
    useMswHandlers(
      http.post(
        '*/api/v1/locations/from-search',
        () => new HttpResponse('<html>gateway</html>', { status: 502 })
      ),
      http.get('*/api/v1/locations', () => HttpResponse.error())
    )

    await expect(
      reasonOf(saveLocationFromSearchFromWeb('payload.signature', 'Home'))
    ).resolves.toBe('unknown')
    await expect(reasonOf(listLocationsFromWeb())).resolves.toBe('unknown')
  })

  it('1.2b-WEB-LIB-05 lets an aborted search reject as an abort, never as a failure', async () => {
    signIn()
    const reached = deferred()
    const answer = deferred()
    useMswHandlers(
      http.get('*/api/v1/locations/search', async () => {
        reached.resolve()
        // Held until the test has seen the abort, so the abort always lands first.
        await answer.promise
        return HttpResponse.json({ data: [] })
      })
    )
    const controller = new AbortController()
    const pending = searchLocationsFromWeb('Chicago', 'en-US', controller.signal)
    // Abort the request in flight, once the server holds it.
    await reached.promise
    controller.abort()

    const caught = await pending.catch((error: unknown) => error)
    answer.resolve()
    expect(caught).not.toBeInstanceOf(LocationRequestError)
    expect((caught as Error).name).toBe('AbortError')
  })
})
