import fs from 'node:fs'
import path from 'node:path'
import { startAuthProxy } from '../e2e-real-session/auth-proxy.mjs'
import { STORY68_AUTH_PROXY_PORT } from '../lib/story68-public-build-env.mjs'
import {
  AUTH_STARTUP_FAILURE_FILE,
  recordAuthStartupFailure,
} from './auth-startup-failure.mjs'

const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
fs.rmSync(path.join(directory, AUTH_STARTUP_FAILURE_FILE), { force: true })
let proxy
try {
  const env = JSON.parse(fs.readFileSync(path.join(directory, 'owned-env.json'), 'utf8'))
  proxy = await startAuthProxy({
    directory,
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    webOrigin: 'http://127.0.0.1:3088',
    port: STORY68_AUTH_PROXY_PORT,
  })
} catch (error) {
  // The log stays private; this record names the failure for web.mjs and the job log.
  recordAuthStartupFailure(directory, error)
  throw error
}
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
