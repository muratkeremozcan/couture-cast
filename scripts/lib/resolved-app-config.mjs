// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// The mobile app config as Expo resolves it for a release prebuild: `expo config --type
// introspect` reads app.json through app.config.ts and applies every plugin, including the gradle
// properties plugins write. The ABI check (scripts/ci/android-release-abis.mjs) and the Release
// R8 record (scripts/lib/minified-debuggable-evidence.mjs) both judge this one result.
//
// It runs in a minimal environment so a developer machine resolves the same config as CI: no
// ambient variables, no Expo CLI dotenv (`EXPO_NO_DOTENV`), and no repository env files in
// app.config.ts (`COUTURE_CONFIG_NO_ENV_FILES`), whose `.env.local` can hold dev build flags.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

/** The whole environment `expo config` gets: offline, production, no env files. */
export function resolveEnv(env = process.env) {
  return {
    PATH: env.PATH ?? '',
    HOME: env.HOME ?? '',
    NODE_ENV: 'production',
    EXPO_OFFLINE: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_NO_DOTENV: '1',
    COUTURE_CONFIG_NO_ENV_FILES: '1',
  }
}

// expo config is bounded; a run killed at the bound takes the same nonzero-status path below.
const CONFIG_TIMEOUT_MS = 120_000

/** `{ config }` or `{ error }` for the app under `<root>/apps/mobile`. Offline, about a second. */
export function resolvedAppConfig(root) {
  // A relative root (the evidence CLI's default '.') resolves against the working directory.
  const mobile = path.resolve(root, 'apps/mobile')
  const cli = createRequire(path.join(mobile, 'package.json')).resolve('expo/bin/cli')
  const result = spawnSync(
    process.execPath,
    [cli, 'config', '--json', '--type', 'introspect'],
    {
      cwd: mobile,
      env: resolveEnv(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: CONFIG_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }
  )
  if (result.status !== 0)
    return {
      error:
        `expo config exited ${result.status}: ` +
        ((result.stderr || result.error?.message || '').trim().split('\n').at(-1) ?? ''),
    }
  try {
    return { config: JSON.parse(result.stdout) }
  } catch {
    return { error: 'expo config printed no JSON' }
  }
}

/** The gradle properties the resolved config's plugins write, as `{ key: value }`. */
export function resolvedGradleProperties(config) {
  const properties = {}
  for (const entry of config?._internal?.modResults?.android?.gradleProperties ?? [])
    if (entry.type === 'property') properties[entry.key] = entry.value
  return properties
}
