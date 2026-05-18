import type { ApiResponse } from '@couture/k6-utils'
import { apiRequest } from '@couture/k6-utils'
import type { RefinedResponse, ResponseType } from 'k6/http'

type JsonObject = Record<string, unknown>

export function getJson<T = JsonObject>(
  path: string,
  options: {
    headers?: Record<string, string>
    tags?: Record<string, string>
    timeout?: string | number
  } = {}
): ApiResponse<T> {
  return apiRequest<T>({
    method: 'GET',
    url: path,
    headers: options.headers,
    tags: options.tags,
    timeout: options.timeout,
  })
}

export function postJson<T = JsonObject>(
  path: string,
  body: unknown,
  options: {
    headers?: Record<string, string>
    tags?: Record<string, string>
    timeout?: string | number
  } = {}
): ApiResponse<T> {
  return apiRequest<T>({
    method: 'POST',
    url: path,
    body,
    headers: options.headers,
    tags: options.tags,
    timeout: options.timeout,
  })
}

export function responseBody(response: RefinedResponse<ResponseType>) {
  return typeof response.body === 'string' ? response.body : ''
}
