import { setupWorker } from 'msw/browser'

// Shim to translate msw/node setupServer API to msw/browser setupWorker API for Vitest browser tests
export function setupServer(...handlers) {
  const worker = setupWorker(...handlers)
  return {
    listen(options) {
      // Start the Service Worker in the browser
      return worker.start({
        onUnhandledRequest: 'bypass',
      })
    },
    resetHandlers(...handlers) {
      return worker.resetHandlers(...handlers)
    },
    use(...handlers) {
      return worker.use(...handlers)
    },
    close() {
      return worker.stop()
    },
  }
}
