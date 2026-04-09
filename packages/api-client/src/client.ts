import { Configuration, DefaultApi, type ConfigurationParameters } from './generated'

export type ApiClientAccessToken = Exclude<
  ConfigurationParameters['accessToken'],
  undefined
>

export type ApiClientOptions = Pick<
  ConfigurationParameters,
  'accessToken' | 'credentials' | 'fetchApi' | 'headers'
>

function isPromiseLike(value: unknown): value is Promise<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

function normalizeClientOptions(
  accessTokenOrOptions?: ApiClientAccessToken | ApiClientOptions
): ApiClientOptions {
  if (
    typeof accessTokenOrOptions === 'string' ||
    typeof accessTokenOrOptions === 'function' ||
    isPromiseLike(accessTokenOrOptions)
  ) {
    return { accessToken: accessTokenOrOptions }
  }

  return accessTokenOrOptions ?? {}
}

// Story 0.9 Task 3 step 4 owner:
// expose one stable client factory here so apps do not need to import generator internals.
//
// Why this step matters:
// generated code changes shape over time. This wrapper keeps the package entrypoint small and lets
// web/mobile code depend on a consistent API surface.
export function createApiClient(
  baseURL: string,
  accessToken?: ApiClientAccessToken
): DefaultApi
export function createApiClient(baseURL: string, options?: ApiClientOptions): DefaultApi
export function createApiClient(
  baseURL: string,
  accessTokenOrOptions?: ApiClientAccessToken | ApiClientOptions
) {
  const options = normalizeClientOptions(accessTokenOrOptions)
  const config = new Configuration({
    basePath: baseURL,
    accessToken: options.accessToken,
    credentials: options.credentials,
    fetchApi: options.fetchApi,
    headers: options.headers,
  })

  return new DefaultApi(config)
}
