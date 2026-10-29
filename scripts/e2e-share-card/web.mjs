import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseEnvFile } from 'dotenv'
import { envKeysToBlank } from '../e2e-real-session/harness.mjs'
import { ROOT_ENV_FILES } from '../local-e2e-database.mjs'

// The browser lane serves a production build. `build` compiles apps/web with the owned
// runtime's public values (its prebuild also builds the shared packages); `start` then
// serves that build, so no route compiles or hot-reloads while the matrix navigates.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** The command, arguments, directory and env one web.mjs subcommand runs. */
export function shareCardWebCommand(command, { root, directory, env }) {
  if (command !== 'build' && command !== 'start')
    throw new Error('usage: node scripts/e2e-share-card/web.mjs build|start')
  const read = (name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
  const build = read('public-build-env.json')
  const proxy = read('auth-harness.json')
  // NEXT_PUBLIC_* values are inlined at build time, so build and start share this env.
  // Its own output directory leaves a developer's apps/web/.next intact.
  const provided = {
    NODE_ENV: 'production',
    WEB_NEXT_DIST_DIR: '.next-share-card',
    NEXT_PUBLIC_API_BASE_URL: build.EXPO_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: proxy.proxyUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: build.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_E2E_AUTH: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
  }
  // apps/web/next.config.ts fills only undefined keys from the repo's env files, and a
  // production build reads .env.prod, so every key those files define is set to ''.
  const fileKeys = ROOT_ENV_FILES.flatMap((file) => {
    const full = path.join(root, file)
    return fs.existsSync(full) ? Object.keys(parseEnvFile(fs.readFileSync(full))) : []
  })
  return {
    ...(command === 'build'
      ? {
          program: process.platform === 'win32' ? 'npm.cmd' : 'npm',
          args: ['run', 'build', '--workspace', 'web'],
          cwd: root,
        }
      : {
          program: process.execPath,
          args: [
            path.join(root, 'node_modules/next/dist/bin/next'),
            'start',
            '--hostname',
            '127.0.0.1',
            '--port',
            '3088',
          ],
          cwd: path.join(root, 'apps/web'),
        }),
    env: {
      ...env,
      ...Object.fromEntries(envKeysToBlank(fileKeys, provided).map((key) => [key, ''])),
      ...provided,
    },
  }
}

if (
  process.argv[1] &&
  pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url
) {
  const { program, args, cwd, env } = shareCardWebCommand(process.argv[2], {
    root,
    directory: path.resolve(
      process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
    ),
    env: process.env,
  })
  const child = spawn(program, args, { cwd, env, stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => child.kill(signal))
  child.once('exit', (code) => process.exit(code ?? 1))
}
