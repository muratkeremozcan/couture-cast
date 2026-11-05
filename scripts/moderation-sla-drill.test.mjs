// Story 6.12 test owner: I-W-DRILL. The real script through the real adapter against a real socket.
// DATABASE_URL points nowhere on every run, so a drill that touched a table would fail here.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = 'scripts/moderation-sla-drill.mjs'

function runDrill(args, env) {
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
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  return once(child, 'close').then(([code]) => ({ code, output }))
}

async function withServer(status, run) {
  const received = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      received.push({ headers: request.headers, body: JSON.parse(body) })
      response.writeHead(status).end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    return await run(`http://127.0.0.1:${server.address().port}/CANARYSECRET`, received)
  } finally {
    server.close()
  }
}

describe('I-W-DRILL', () => {
  it('--local posts one payload to a loopback server and exits 0', async () => {
    const { code, output } = await runDrill(['--local'], {})
    assert.equal(code, 0, output)
    assert.match(output, /target=local result=delivered/)
  })

  it('delivers one drill payload naming no case, with the id as the idempotency key', async () => {
    await withServer(204, async (url, received) => {
      const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: url })
      assert.equal(code, 0, output)
      assert.equal(received.length, 1)
      const [{ headers, body }] = received
      assert.deepEqual(Object.keys(body).sort(), ['detectedAt', 'id', 'kind', 'text'])
      assert.equal(body.kind, 'drill')
      assert.equal(headers['idempotency-key'], body.id)
      assert.ok(!output.includes('CANARYSECRET'))
    })
  })

  it('exits non-zero on a failing channel, without printing the URL', async () => {
    await withServer(500, async (url) => {
      const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: url })
      assert.equal(code, 1, output)
      assert.match(output, /result=http_5xx/)
      assert.ok(!output.includes('CANARYSECRET'))
    })
  })

  it('exits 2 when no URL is set', async () => {
    const { code, output } = await runDrill([], { MODERATION_OPS_WEBHOOK_URL: '' })
    assert.equal(code, 2, output)
  })

  it('refuses a URL the adapter refuses, without printing it', async () => {
    const { code, output } = await runDrill([], {
      MODERATION_OPS_WEBHOOK_URL: 'http://CANARYSECRET.example.test/hook',
    })
    assert.equal(code, 1, output)
    assert.match(output, /result=invalid_config/)
    assert.ok(!output.toLowerCase().includes('canarysecret'))
  })
})
