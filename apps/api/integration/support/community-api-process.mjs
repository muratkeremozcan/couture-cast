// Story 6.5 acceptance: the compiled API (`dist/src/main.js`) as an owned child process.
//
// Production entry point unchanged; the child only pins an isolated database, a loopback
// Redis, a port, and the local fixture identity and flag lanes the acceptance plan allows
// inside an isolated lane. It reports ready once `/api/health` answers.
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
const require = createRequire(import.meta.url)
// `load-env` lets `.env.local` override keys when TEST_ENV=local. Run it first, then put
// every owned value back, so `main.js` (which imports the already-loaded module) can only
// see this lane's database, Redis and port.
const owned = { ...process.env }
require('../../dist/src/load-env.js')
Object.assign(process.env, owned)
for (const key of ['DATABASE_URL', 'REDIS_URL', 'PORT'])
  if (process.env[key] !== owned[key]) throw new Error(`Owned ${key} was overridden`)
const database = new URL(process.env.DATABASE_URL)
if (!/^\/tea_community_[a-f0-9]{32}$/.test(database.pathname))
  throw new Error('Isolated UUID DB required')
const redis = new URL(process.env.REDIS_URL)
if (redis.hostname !== '127.0.0.1') throw new Error('Owned loopback Redis required')
const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) throw new Error('Owned port required')
await import('../../dist/src/main.js')
const deadline = performance.now() + 30_000
let healthy = false
while (!healthy && performance.now() < deadline) {
  healthy = await fetch(`http://127.0.0.1:${port}/api/health`)
    .then((response) => response.ok)
    .catch(() => false)
  if (!healthy) await delay(100)
}
if (!healthy) throw new Error('Owned API did not become healthy')
process.send?.({ event: 'ready', value: { pid: process.pid, port } })
process.on('message', ({ id, op }) => {
  if (op === 'close') {
    process.send?.({ id, value: null })
    process.disconnect()
    process.exit(0)
  }
  process.send?.({ id, value: null })
})
