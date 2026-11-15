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

/**
 * The owned auth harness, once the auth proxy (started in the background, scripts/e2e-share-card/
 * auth.mjs) has written all of it: a build that read it first failed ENOENT (dispatch
 * 43687651012 browser-acceptance). Fails as owned_auth_harness_exited when the service already
 * recorded its exit, and as owned_auth_harness_timeout after `timeoutMs`.
 */
export async function waitForAuthHarness({
  directory,
  exitFile = null,
  timeoutMs = 120_000,
  now = Date.now,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const started = now()
  for (;;) {
    if (exitFile && fs.existsSync(exitFile))
      throw new Error(
        `owned_auth_harness_exited: the owned auth service exited with status ${fs.readFileSync(exitFile, 'utf8').trim()}`
      )
    try {
      const harness = JSON.parse(
        fs.readFileSync(path.join(directory, 'auth-harness.json'), 'utf8')
      )
      if (typeof harness?.proxyUrl === 'string') return harness
    } catch {
      // Not written yet, or written in part: the proxy writes it once it listens.
    }
    if (now() - started >= timeoutMs)
      throw new Error(
        `owned_auth_harness_timeout: no auth-harness.json after ${timeoutMs} ms`
      )
    await delay(500)
  }
}

if (
  process.argv[1] &&
  pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url
) {
  await waitForAuthHarness({
    directory: path.resolve(
      process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
    ),
    // The CI job records each owned service's exit there (pr-share-card-native.yml); a local
    // /tmp may hold one from an earlier run.
    exitFile: process.env.GITHUB_ACTIONS === 'true' ? '/tmp/cc68-auth.exit' : null,
  })
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
