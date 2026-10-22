import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  runPreviewProbe,
  targetRefusal,
} from '../../../scripts/probe-community-preview.mjs'

// Story 6.5 round 8 M2: the hosted probe writes (signup, posts, reactions) only to a preview.
// A recording server stands in for the target and answers health with the given environment.
let server: Server | undefined
afterEach(async () => {
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve()
  )
  server = undefined
})

async function target(environment: string) {
  const requests: string[] = []
  let upgrades = 0
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify(
        request.url === '/api/health' ? { status: 'ok', environment } : { data: {} }
      )
    )
  })
  server.on('upgrade', (_request, socket) => {
    upgrades++
    socket.destroy()
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { apiBaseUrl: `http://127.0.0.1:${port}`, requests, upgrades: () => upgrades }
}

describe('probe-community-preview target guard', () => {
  it.each([false, true])(
    'aborts on a production health answer with zero writes (local opt-in %s)',
    async (allowLocalTarget) => {
      const production = await target('production')
      const evidence = await runPreviewProbe({
        apiBaseUrl: production.apiBaseUrl,
        allowLocalTarget,
      })
      expect(evidence.claims.environment).toMatchObject({ status: 'fail' })
      expect(production.requests).toEqual(['GET /api/health'])
      expect(production.upgrades()).toBe(0)
      expect(Object.keys(evidence.claims)).toEqual(['environment'])
    }
  )

  it('admits a preview, and a local test target only on loopback with the opt-in', () => {
    expect(targetRefusal('https://api-preview.example', 'preview')).toBeNull()
    expect(targetRefusal('http://127.0.0.1:4065', 'test', true)).toBeNull()
    expect(targetRefusal('http://127.0.0.1:4065', 'test')).toMatch(
      /writes only to a preview/
    )
    expect(targetRefusal('https://api.example', 'test', true)).toMatch(
      /writes only to a preview/
    )
    expect(targetRefusal('http://localhost:4065', 'production', true)).toMatch(
      /writes only to a preview/
    )
    expect(targetRefusal('https://api-preview.example', null)).toMatch(
      /writes only to a preview/
    )
  })
})
