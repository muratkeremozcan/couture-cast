import type { RequestHandler } from 'msw'

type MswController = {
  use: (...handlers: RequestHandler[]) => void
}

declare global {
  // eslint-disable-next-line no-var
  var __MSW_RUNTIME_CONTROLLER__: MswController | undefined
}

export function useMswHandlers(...handlers: RequestHandler[]) {
  const controller = globalThis.__MSW_RUNTIME_CONTROLLER__
  if (!controller) {
    throw new Error('MSW runtime controller is not initialized in vitest.setup.ts')
  }
  controller.use(...handlers)
}
