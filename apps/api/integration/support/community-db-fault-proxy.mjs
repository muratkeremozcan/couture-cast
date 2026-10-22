// Story 6.5 acceptance: opaque TCP fault control for this child's connections only.
import { createServer, connect } from 'node:net'
const upstream = new URL(process.env.STORY65_PROXY_TARGET)
if (!['127.0.0.1', 'localhost', '::1'].includes(upstream.hostname))
  throw new Error('Local DB required')
const sockets = new Set()
let paused = false
const buffered = []
const forward = (target, bytes) => {
  if (paused) buffered.push([target, bytes])
  else if (!target.destroyed) target.write(bytes)
}
const server = createServer((client) => {
  const backend = connect({
    host: upstream.hostname,
    port: Number(upstream.port || 5432),
  })
  sockets.add(client)
  sockets.add(backend)
  client.on('data', (bytes) => forward(backend, bytes))
  backend.on('data', (bytes) => forward(client, bytes))
  for (const socket of [client, backend]) {
    socket.on('error', () => {
      client.destroy()
      backend.destroy()
    })
    socket.on('close', () => {
      sockets.delete(socket)
      client.destroy()
      backend.destroy()
    })
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
process.send?.({
  event: 'ready',
  value: { port: server.address().port, pid: process.pid },
})
process.on('message', ({ id, op }) => {
  if (op === 'pause') paused = true
  if (op === 'resume') {
    paused = false
    for (const [socket, bytes] of buffered.splice(0))
      if (!socket.destroyed) socket.write(bytes)
  }
  if (op === 'cut' || op === 'close') {
    buffered.length = 0
    sockets.forEach((socket) => socket.destroy())
  }
  if (op === 'close') {
    server.close(() => {
      process.send?.({ id, value: null })
      process.disconnect()
    })
    return
  }
  process.send?.({ id, value: { connections: sockets.size / 2 } })
})
