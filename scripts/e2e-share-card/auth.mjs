import fs from 'node:fs'
import path from 'node:path'
import { startAuthProxy } from '../e2e-real-session/auth-proxy.mjs'

const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const env = JSON.parse(fs.readFileSync(path.join(directory, 'owned-env.json'), 'utf8'))
const proxy = await startAuthProxy({
  directory,
  supabaseUrl: env.SUPABASE_URL,
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  webOrigin: 'http://127.0.0.1:3088',
  port: 53068,
})
console.log(
  JSON.stringify({ status: 'ready', proxyUrl: proxy.proxyUrl, pid: process.pid })
)
let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await proxy.close()
  process.exit(0)
}
process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
