// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// S2-06: the tarpit must hold a request open until the client's own timeout aborts it. A server
// that answers, or refuses, would let the Maestro check pass without ever reaching the app's
// AbortController path.
import assert from 'node:assert/strict'
import net from 'node:net'
import { test } from 'node:test'
import { startTarpit } from './network-tarpit.mjs'

test('a request to the tarpit is accepted and ends only when the client timeout aborts it', async (t) => {
  const tarpit = await startTarpit({ host: '127.0.0.1' })
  t.after(tarpit.close)
  const started = performance.now()
  await assert.rejects(
    fetch(`http://127.0.0.1:${tarpit.port}/api/v1/ritual`, {
      signal: AbortSignal.timeout(400),
    }),
    { name: 'TimeoutError' }
  )
  assert.ok(performance.now() - started >= 350, 'the request hung until the timeout')
  assert.equal(tarpit.accepted(), 1)
})

test('close ends the held connections', async () => {
  const tarpit = await startTarpit({ host: '127.0.0.1' })
  const socket = net.connect(tarpit.port, '127.0.0.1')
  // Closing destroys the server side, so the client may see a reset; only the close matters.
  socket.on('error', () => undefined)
  await new Promise((resolve) => socket.once('connect', resolve))
  socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
  while (tarpit.accepted() === 0) await new Promise((resolve) => setImmediate(resolve))
  const ended = new Promise((resolve) => socket.once('close', resolve))
  await tarpit.close()
  await ended
  assert.equal(tarpit.accepted(), 1)
})
