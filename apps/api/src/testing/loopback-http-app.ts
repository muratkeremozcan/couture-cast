import type { INestApplication } from '@nestjs/common'
import { createServer, type RequestListener, type Server } from 'node:http'

/**
 * Initializes the app, binds one 127.0.0.1 listener for its lifetime and returns its base
 * URL. Hand supertest this URL and never the bare server: given a server that is not
 * listening, supertest calls listen(0) on the dual-stack wildcard and then requests
 * 127.0.0.1. macOS can give that wildcard a port another process already holds on
 * 127.0.0.1, and that more specific listener answers instead (a foreign 401, 404, reset or
 * hang up). A listener bound to 127.0.0.1 owns its port or fails to bind. The
 * `no-restricted-syntax` rule for apps/api specs in .eslintrc.js enforces this.
 */
export async function listenHttpApp(app: INestApplication): Promise<string> {
  await app.init()
  const server = app.getHttpServer() as Server
  if (!server.listening) await app.listen(0, '127.0.0.1')
  return httpTestUrl(app)
}

/** The base URL of an app that `listenHttpApp` already bound. */
export function httpTestUrl(app: INestApplication): string {
  const address = (app.getHttpServer() as Server).address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP test app is not bound')
  return `http://127.0.0.1:${address.port}`
}

/**
 * Serves a plain request handler, such as an Express app, on one 127.0.0.1 listener for
 * the same reason as `listenHttpApp`: supertest given the handler itself would bind the
 * wildcard. Returns the base URL and a close function the caller must await.
 */
export async function listenHttpHandler(
  handler: RequestListener
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP test handler is not bound')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  }
}
