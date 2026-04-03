/*
  Shared packages are built from workspace scripts during API/Web deploys.
  In CI, especially Vercel app-root installs, root devDependency bins like
  `rimraf` and `tsc` are not always available on PATH. This helper makes the
  package build deterministic by doing cleanup with Node, then resolving a
  local TypeScript CLI when present and falling back to `npm exec` otherwise.
*/

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptsDir, '..')

const tsconfigPath = process.argv[2]

if (!tsconfigPath) {
  console.error('Usage: node ../../scripts/build-typescript-package.mjs <tsconfig-path>')
  process.exit(1)
}

for (const target of ['dist', 'tsconfig.build.tsbuildinfo']) {
  rmSync(resolve(process.cwd(), target), { force: true, recursive: true })
}

const typescriptBin = resolveTypeScriptBin()

if (typescriptBin) {
  const result = spawnSync(process.execPath, [typescriptBin, '-p', tsconfigPath], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  process.exit(result.status ?? 1)
}

const fallback = spawnSync(
  'npm',
  ['exec', '--yes', '--package=typescript@5.9.3', '--', 'tsc', '-p', tsconfigPath],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
  }
)

if (fallback.error) {
  throw fallback.error
}

process.exit(fallback.status ?? 1)

function resolveTypeScriptBin() {
  const candidatePaths = [
    process.cwd(),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '../..'),
    repoRoot,
    resolve(repoRoot, 'apps/api'),
    resolve(repoRoot, 'apps/web'),
    resolve(repoRoot, 'apps/mobile'),
  ]

  for (const candidatePath of candidatePaths) {
    try {
      return require.resolve('typescript/bin/tsc', { paths: [candidatePath] })
    } catch {
      // Keep scanning. Vercel monorepo installs can root node_modules at the app,
      // the repo, or not at all, in which case we fall back to npm exec.
    }
  }

  return null
}
