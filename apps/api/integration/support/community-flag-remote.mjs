// Story 6.5 acceptance: owned loopback remote flag provider with per-member modes.
import { createServer } from 'node:http'

const modes = new Map()
const calls = []
const held = new Set()
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const member = url.searchParams.get('member') ?? ''
  const mode = modes.get(member) ?? 'true'
  const call = {
    member,
    mode,
    at: performance.now(),
    wall: Date.now(),
    endedAt: null,
    outcome: null,
  }
  calls.push(call)
  const finish = (outcome) => {
    call.endedAt ??= performance.now()
    call.outcome ??= outcome
  }
  // A closed request before an answer is the caller's abort reaching the network.
  response.once('close', () => finish(response.writableEnded ? 'answered' : 'aborted'))
  const answer = (value) => {
    if (response.destroyed) return
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ value }))
  }
  if (mode === 'true' || mode === 'false') answer(mode === 'true')
  else if (mode === 'fail') {
    response.writeHead(503)
    response.end()
  } else if (mode === 'late') setTimeout(() => answer(true), 1200)
  else held.add(response)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
process.send?.({
  event: 'ready',
  value: { port: server.address().port, pid: process.pid },
})
process.on('message', ({ id, op, args }) => {
  if (op === 'mode') modes.set(args.member, args.mode)
  if (op === 'close') {
    held.forEach((response) => response.destroy())
    server.closeAllConnections()
    server.close(() => {
      process.send?.({ id, value: null })
      process.disconnect()
    })
    return
  }
  process.send?.({ id, value: op === 'calls' ? calls : null })
})
