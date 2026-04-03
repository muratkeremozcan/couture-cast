import { Configuration, DefaultApi } from './generated'

// Story 0.9 Task 3 step 4 owner:
// expose one stable client factory here so apps do not need to import generator internals.
//
// Why this step matters:
// generated code changes shape over time. This wrapper keeps the package entrypoint small and lets
// web/mobile code depend on a consistent API surface.
export function createApiClient(baseURL: string, accessToken?: string) {
  const config = new Configuration({
    basePath: baseURL,
    accessToken,
  })

  return new DefaultApi(config)
}
