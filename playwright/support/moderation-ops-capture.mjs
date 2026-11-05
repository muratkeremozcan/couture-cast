// Learning path Step 52: Moderation SLA monitoring and escalation.
// Story 6.12 test owner: the operations webhook receiver of the local E2E stack.
// It answers the `/__admin/requests` format, so the playwright-utils webhook registry reads it.
// Loopback only. `scripts/start-api-e2e-with-workers.mjs` points MODERATION_OPS_WEBHOOK_URL here.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.env.MODERATION_OPS_CAPTURE_PORT || 4319)
const journal = []

const send = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const body = await readBody(request)

  if (url.pathname === '/health') return send(response, 200, { status: 'ok' })

  if (url.pathname === '/webhook' && request.method === 'POST') {
    const loggedDate = Date.now()
    journal.push({
      id: randomUUID(),
      loggedDate,
      request: {
        url: url.pathname,
        absoluteUrl: url.toString(),
        method: request.method,
        headers: request.headers,
        body,
        loggedDate,
        loggedDateString: new Date(loggedDate).toISOString(),
      },
    })
    return send(response, 200, {})
  }

  if (url.pathname === '/__admin/requests') {
    if (request.method === 'DELETE') {
      journal.length = 0
      return send(response, 200, {})
    }
    if (request.method === 'GET') {
      const since = url.searchParams.get('since')
      const floor = since ? new Date(since).getTime() : 0
      return send(response, 200, {
        requests: journal.filter((entry) => entry.request.loggedDate >= floor),
      })
    }
  }

  if (url.pathname.startsWith('/__admin/requests/') && request.method === 'DELETE') {
    const index = journal.findIndex(
      (entry) => entry.id === url.pathname.slice('/__admin/requests/'.length)
    )
    if (index >= 0) journal.splice(index, 1)
    return send(response, 200, {})
  }

  return send(response, 404, { error: 'not_found' })
})

server.listen(port, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close())
