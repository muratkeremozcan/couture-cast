// A dependency tree restored from the cache (.github/actions/node-dependencies) is used only
// if every native piece it carries works on this runner: the binaries install scripts
// download or build into node_modules (esbuild, sharp, lightningcss, the Prisma engines,
// the Supabase CLI, onnxruntime, the unrs resolver). Exits 1 naming what failed, and the
// action then installs instead.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const bin = (name) => path.join(root, 'node_modules/.bin', name)

export const CHECKS = {
  esbuild: () => require('esbuild').transformSync('let a: number = 1', { loader: 'ts' }),
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

const failed = []
for (const [name, check] of Object.entries(CHECKS))
  try {
    check()
  } catch (error) {
    failed.push(`${name}: ${String(error?.message ?? error).split('\n')[0]}`)
  }
if (failed.length) {
  console.log(
    `::warning::The restored dependency tree fails on this runner; installing instead. ${failed.join('; ')}`
  )
  process.exit(1)
}
console.log(
  `The restored dependency tree works on this runner: ${Object.keys(CHECKS).join(', ')}.`
)
