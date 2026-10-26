import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const build = JSON.parse(
  fs.readFileSync(path.join(directory, 'public-build-env.json'), 'utf8')
)
const proxy = JSON.parse(
  fs.readFileSync(path.join(directory, 'auth-harness.json'), 'utf8')
)
const child = spawn(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'dev', '--workspace', 'web', '--', '--hostname', '127.0.0.1', '--port', '3088'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NEXT_PUBLIC_API_BASE_URL: build.EXPO_PUBLIC_API_BASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: proxy.proxyUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: build.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_E2E_AUTH: 'false',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  }
)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
child.once('exit', (code) => process.exit(code ?? 1))
