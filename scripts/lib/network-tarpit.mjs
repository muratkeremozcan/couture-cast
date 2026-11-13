#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S2-06 (TEA-12): the API stand-in for maestro/network-timeout/dev-client-timeout.yaml. It
// accepts every TCP connection and never answers, so a request from the app hangs until the
// app's own AbortController fires (the Home ritual request aborts after 15 s). A refused port or
// airplane mode fails at once and would never reach that timeout path, which is the `expo/fetch`
// and Hermes behavior the check exists for.
//
//   node scripts/lib/network-tarpit.mjs --port 4010
import fs from 'node:fs'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

/** Starts the tarpit; resolves once it listens. `port: 0` picks a free port. */
export function startTarpit({ port = 0, host = '0.0.0.0' } = {}) {
  const sockets = new Set()
  let accepted = 0
  const server = net.createServer((socket) => {
    accepted += 1
    sockets.add(socket)
    // Read and discard the request so the client sees it was delivered, then say nothing.
    socket.on('data', () => undefined)
    socket.on('error', () => undefined)
    socket.on('close', () => sockets.delete(socket))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        accepted: () => accepted,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          }),
      })
    })
  })
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const index = process.argv.indexOf('--port')
  const port = index > 0 ? Number(process.argv[index + 1]) : 4010
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('network_tarpit_bad_port')
    process.exit(1)
  }
  const tarpit = await startTarpit({ port })
  console.log(`network tarpit listening on ${tarpit.port}; it accepts and never answers`)
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => tarpit.close().then(() => process.exit(0)))
}
