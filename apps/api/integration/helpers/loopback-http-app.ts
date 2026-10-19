import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'

/** Own one IPv4 listener for the application's lifetime; supertest never opens implicit listeners. */
export async function listenHttpApp(app: INestApplication): Promise<string> {
  await app.init()
  const server = app.getHttpServer() as Server
  if (!server.listening) await app.listen(0, '127.0.0.1')
  return httpTestUrl(app)
}

export function httpTestUrl(app: INestApplication): string {
  const address = (app.getHttpServer() as Server).address()
  if (!address || typeof address === 'string')
    throw new Error('HTTP test app is not bound')
  return `http://127.0.0.1:${address.port}`
}
