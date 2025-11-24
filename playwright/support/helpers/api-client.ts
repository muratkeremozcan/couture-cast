import type { APIRequestContext, APIResponse } from '@playwright/test'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiRequestParams<TRequest = unknown> = {
  request: APIRequestContext
  path: string
  baseURL: string
  method?: HttpMethod
  data?: TRequest
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
}

export type ApiResponsePayload<TResponse> = {
  status: number
  body: TResponse
  raw: APIResponse
}

export async function apiRequest<TResponse = unknown, TRequest = unknown>(
  params: ApiRequestParams<TRequest>
): Promise<ApiResponsePayload<TResponse>> {
  const { request, path, baseURL, method = 'GET', data, headers = {}, query } = params

  const url = new URL(path, baseURL)
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (typeof value === 'undefined') {
        return
      }
      url.searchParams.set(key, String(value))
    })
  }

  const normalizedHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...headers,
  }

  const requestOptions: Parameters<APIRequestContext['fetch']>[1] = {
    method,
    headers: normalizedHeaders,
  }

  if (typeof data !== 'undefined') {
    requestOptions.data = data
  }

  const response = await request.fetch(url.toString(), requestOptions)

  if (!response.ok()) {
    const failureBody = await safeRead(response)
    throw new Error(
      `API ${method} ${url.pathname} failed: ${response.status()} ${JSON.stringify(failureBody)}`
    )
  }

  return {
    status: response.status(),
    body: (await safeRead(response)) as TResponse,
    raw: response,
  }
}

async function safeRead(response: APIResponse): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return await response.text()
  }
}
