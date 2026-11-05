// Story 6.12 test owner: I-W-DRILL. The real script through the real adapter against a real socket.
// DATABASE_URL points nowhere on every run, so a drill that touched a table would fail here.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })

const repoRoot = path.resolve(__dirname, '../../..')
const SCRIPT = 'scripts/moderation-sla-drill.mjs'

async function runDrill(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/none',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  const [code] = (await once(child, 'close')) as [number | null]
  return { code, output }
}

type Received = { headers: IncomingHttpHeaders; body: Record<string, unknown> }

async function withServer(
  status: number,
  run: (url: string, received: Received[]) => Promise<void>
) {
  const received: Received[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      received.push({
        headers: request.headers,
        body: JSON.parse(body) as Record<string, unknown>,
      })
      response.writeHead(status).end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}/CANARYSECRET`, received)
  } finally {
    server.close()
  }
}

describe('I-W-DRILL', () => {
  it('--local posts one payload to a loopback server and exits 0', async () => {
    const { code, output } = await runDrill(['--local'], {})
    expect(code, output).toBe(0)
    expect(output).toMatch(/target=local result=delivered/)
  })

  it('delivers one drill payload naming no case, with the id as the idempotency key', async () => {
    await withServer(204, async (url, received) => {
      const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: url })
      expect(code, output).toBe(0)
      expect(received).toHaveLength(1)
      const { headers, body } = received[0]!
      expect(Object.keys(body).sort()).toEqual(['detectedAt', 'id', 'kind', 'text'])
      expect(body.kind).toBe('drill')
      expect(headers['idempotency-key']).toBe(body.id)
      expect(output).not.toContain('CANARYSECRET')
    })
  })

  it('exits non-zero on a failing channel, without printing the URL', async () => {
    await withServer(500, async (url) => {
      const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: url })
      expect(code, output).toBe(1)
      expect(output).toMatch(/result=http_5xx/)
      expect(output).not.toContain('CANARYSECRET')
    })
  })

  it('exits 2 when no URL is set', async () => {
    const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: '' })
    expect(code, output).toBe(2)
  })

  it('refuses a URL the adapter refuses, without printing it', async () => {
    const { code, output } = await runDrill([], {
      MODERATION_OPS_WEBHOOK_URL: 'http://CANARYSECRET.example.test/hook',
    })
    expect(code, output).toBe(1)
    expect(output).toMatch(/result=invalid_config/)
    expect(output.toLowerCase()).not.toContain('canarysecret')
  })
})
