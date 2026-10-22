// Story 6.5 acceptance: owned loopback provider; never logs payloads or credentials.
import { createServer } from 'node:http'
let mode = 'accepted'
const ledger = []
const receipts = []
const held = new Set()
const entries = new WeakMap()
const answer = (response) => {
  if (response.destroyed) return
  const entry = entries.get(response)
  if (entry && mode !== 'invalid') {
    entry.accepted = true
    entry.acceptedAt ??= Date.now()
  }
  response.setHeader('content-type', 'application/json')
  const ticket =
    mode === 'invalid'
      ? {
          status: 'error',
          message: 'Controlled invalid registration',
          details: { error: 'DeviceNotRegistered' },
        }
      : { status: 'ok', id: `isolated-ticket-${ledger.length}` }
  response.end(JSON.stringify({ data: ticket }))
}
const server = createServer((request, response) => {
  let bytes = ''
  request.on('data', (chunk) => {
    bytes += chunk
  })
  request.on('end', () => {
    try {
      const message = JSON.parse(bytes)
      if (request.url === '/receipts') {
        // Receipt lookups for tickets this recorder issued; every one settled ok.
        if (!Array.isArray(message.ids)) throw new Error('Invalid receipt request')
        receipts.push({
          at: performance.now(),
          wall: Date.now(),
          ids: message.ids.length,
        })
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            data: Object.fromEntries(message.ids.map((id) => [id, { status: 'ok' }])),
          })
        )
        return
      }
      if (
        typeof message.to !== 'string' ||
        !message.data ||
        typeof message.data !== 'object'
      )
        throw new Error('Invalid provider request')
      const entry = {
        accepted: mode === 'accepted' || mode === 'accept-hold',
        acceptedAt: mode === 'accepted' || mode === 'accept-hold' ? Date.now() : null,
        ordinal: ledger.length + 1,
        at: performance.now(),
        wall: Date.now(),
        type: message.data.type,
        keys: Object.keys(message.data).sort(),
      }
      entries.set(response, entry)
      ledger.push(entry)
      process.send?.({ event: 'request', value: entry })
      if (mode === 'hold' || mode === 'accept-hold') {
        held.add(response)
        response.once('close', () => held.delete(response))
      } else if (mode === 'disconnect') response.destroy()
      else answer(response)
    } catch {
      response.writeHead(400)
      response.end()
    }
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
process.send?.({
  event: 'ready',
  value: { port: server.address().port, pid: process.pid },
})
process.on('message', ({ id, op, args }) => {
  if (op === 'mode') mode = args
  if (op === 'release') {
    mode = args ?? 'accepted'
    held.forEach(answer)
    held.clear()
  }
  if (op === 'close') {
    held.forEach((response) => response.destroy())
    server.closeAllConnections()
    server.close(() => {
      process.send?.({ id, value: null })
      process.disconnect()
    })
    return
  }
  process.send?.({
    id,
    value:
      op === 'ledger'
        ? ledger
        : op === 'receipts'
          ? receipts
          : op === 'state'
            ? { held: held.size }
            : null,
  })
})
