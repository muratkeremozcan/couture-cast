// A dependency tree restored from the cache (.github/actions/node-dependencies) is used only
// if it is the tree package-lock.json pins and every native piece in it works on this
// runner. Structure: every non-optional package the lockfile lists is installed at its
// version (npm's own record of the install, node_modules/.package-lock.json, and the
// package.json on disk), and nothing else is. Native: the binaries install scripts put in
// node_modules (esbuild, sharp, lightningcss, the Prisma engines, the Supabase CLI,
// onnxruntime, the unrs resolver) load and run. Exits 1 naming what failed, and the action
// then installs instead.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** Each non-optional package the lockfile pins that npm did not install at that version. */
function unmetLockEntries(locked, installed) {
  const problems = []
  for (const [key, entry] of Object.entries(locked)) {
    if (!key.includes('node_modules/')) continue
    const record = installed[key]
    // Optional packages for another platform are not installed here.
    if (!record) {
      if (!entry.optional) problems.push(`${key} is not installed`)
    } else if ((record.version ?? null) !== (entry.version ?? null))
      problems.push(`${key} is ${record.version}, the lockfile pins ${entry.version}`)
  }
  return problems
}

/** Each package npm recorded that the lockfile lacks or the disk no longer holds. */
function strayOrMissingInstalls(root, locked, installed) {
  const problems = []
  for (const [key, record] of Object.entries(installed)) {
    const manifest = path.join(root, key, 'package.json')
    if (!locked[key]) problems.push(`${key} is installed but not in the lockfile`)
    // npm's record says it was installed; the directory must still hold it.
    else if (!existsSync(manifest))
      problems.push(`${key} is recorded but missing on disk`)
    else if (!record.link && readJson(manifest).version !== record.version)
      problems.push(`${key} on disk is not ${record.version}`)
  }
  return problems
}

/** How the installed tree under `root` differs from the one its package-lock.json pins. */
export function treeProblems(root) {
  const hiddenFile = path.join(root, 'node_modules/.package-lock.json')
  if (!existsSync(hiddenFile)) return ['node_modules/.package-lock.json is missing']
  const locked = readJson(path.join(root, 'package-lock.json')).packages ?? {}
  const installed = readJson(hiddenFile).packages ?? {}
  return [
    ...unmetLockEntries(locked, installed),
    ...strayOrMissingInstalls(root, locked, installed),
  ]
}

export function nativeChecks(root) {
  const require = createRequire(path.join(root, 'package.json'))
  const bin = (name) => path.join(root, 'node_modules/.bin', name)
  return {
    esbuild: () =>
      require('esbuild').transformSync('let a: number = 1', { loader: 'ts' }),
    sharp: () =>
      require('sharp')({
        create: { width: 1, height: 1, channels: 3, background: '#000' },
      }),
    lightningcss: () =>
      require('lightningcss').transform({
        filename: 'a.css',
        code: Buffer.from('a{color:red}'),
      }),
    'unrs-resolver': () => require('unrs-resolver'),
    'onnxruntime-node': () => require('onnxruntime-node'),
    'prisma engines': () => execFileSync(bin('prisma'), ['--version'], { stdio: 'pipe' }),
    'supabase CLI': () => execFileSync(bin('supabase'), ['--version'], { stdio: 'pipe' }),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const failed = treeProblems(root).slice(0, 10)
  if (failed.length === 0)
    for (const [name, check] of Object.entries(nativeChecks(root)))
      try {
        check()
      } catch (error) {
        failed.push(`${name}: ${String(error?.message ?? error).split('\n')[0]}`)
      }
  if (failed.length) {
    console.log(
      `::warning::The restored dependency tree is not this lockfile's working tree; installing instead. ${failed.join('; ')}`
    )
    process.exit(1)
  }
  console.log(
    `The restored dependency tree matches package-lock.json and its native pieces work: ${Object.keys(nativeChecks(root)).join(', ')}.`
  )
}
