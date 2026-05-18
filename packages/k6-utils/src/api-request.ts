// Thin JSON request wrapper around k6's http module.
// Eliminates the repetitive JSON.stringify + Content-Type + .json() ceremony.
//
// Why: every JSON API call in k6 needs the same boilerplate:
//   const res = http.post(url, JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
//   const parsed = res.json() as SomeType
//
// This wrapper handles it in one call:
//   const { status, body } = apiRequest<T>({ method: 'POST', url: `${BASE_URL}/api/pizza`, body: payload })
//
// API shape matches playwright-utils: single options object with { method, url, body, headers }.
// baseUrl/path separation from playwright-utils is intentionally omitted because k6 has no
// config-level baseURL to pull from — it would just be an extra prop with no payoff.

import type { Params, Response } from 'k6/http'
import http from 'k6/http'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export type ApiRequestParams = {
  /** HTTP method to use. */
  method: HttpMethod
  /** Full request URL. */
  url: string
  /** Request body. Auto-serialized to JSON via JSON.stringify. */
  body?: unknown
  /** Additional headers. Content-Type: application/json is added automatically; caller headers win on conflict. */
  headers?: Record<string, string>
  /** k6 metric tags. Passed through to the underlying http call. */
  tags?: Record<string, string>
  /** Request timeout (string like '30s' or number in ms). */
  timeout?: string | number
}

export type ApiResponse<T> = {
  /** HTTP status code */
  status: number
  /** Parsed JSON response body */
  body: T
  /** Full k6 response for advanced use (timings, cookies, etc.) */
  rawResponse: Response
}

/**
 * Makes a JSON HTTP request using k6's http module.
 * Auto-serializes the request body, sets Content-Type, and parses the JSON response.
 * @param params - Request configuration: { method, url, body, headers, tags, timeout }
 * @returns `{ status, body, rawResponse }` where body is the parsed JSON typed as T
 */
export function apiRequest<T = unknown>(params: ApiRequestParams): ApiResponse<T> {
  const { method, url, body, headers = {}, tags, timeout } = params

  // Merge Content-Type with caller headers; caller can override if needed
  const mergedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }

  const k6Params: Params = { headers: mergedHeaders }
  if (tags) k6Params.tags = tags
  if (timeout !== undefined) k6Params.timeout = timeout

  // Serialize body for methods that carry a payload
  const serializedBody = body !== undefined && body !== null ? JSON.stringify(body) : null

  // k6's http.request handles all methods uniformly
  const res = http.request(method, url, serializedBody, k6Params)

  // Parse JSON response; fall back to null for empty bodies (204, HEAD, etc.)
  let parsed: T
  if (method === 'HEAD' || res.status === 204 || res.body == null || res.body === '') {
    parsed = null as T
  } else {
    parsed = res.json() as T
  }

  return {
    status: res.status,
    body: parsed,
    rawResponse: res as Response,
  }
}
