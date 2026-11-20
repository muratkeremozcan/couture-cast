// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
// Static checks of the hosted wardrobe worker image: its Dockerfile text, the launcher's refusals
// and the prune script's guards. Nothing here builds an image or opens a connection.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')

interface LauncherModule {
  startRefusal: (
    env: Record<string, string | undefined>,
    options?: { drillChild?: boolean }
  ) => string | null
  loadedModelRuntimes: (paths: string[]) => string[]
  SHUTDOWN_DEADLINE_MS: number
  DRILL_ENV: Record<string, string>
  DRILL_CHILD_ARGUMENT: string
}
interface PruneModule {
  ENTRY_FILES: string[]
  FORBIDDEN_PACKAGES: string[]
  forbiddenPackagesIn: (names: string[]) => string[]
  outDirectoryRefusal: (outDir: string, root?: string) => string | null
  DEFAULT_MAX_NODE_MODULES_MB: number
}

async function load<T>(relative: string): Promise<T> {
  return (await import(path.join(repoRoot, relative))) as T
}

describe('Dockerfile.wardrobe-worker', () => {
  const dockerfile = read('apps/api/Dockerfile.wardrobe-worker')
  const community = read('apps/api/Dockerfile.community-worker')
  const instructions = dockerfile
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')

  it('pins the same base image digest as the community worker', () => {
    const pin = (text: string) =>
      /^ARG NODE_IMAGE=(node:[^\s]+@sha256:[0-9a-f]{64})$/m.exec(text)?.[1]
    expect(pin(dockerfile)).toBeDefined()
    expect(pin(dockerfile)).toBe(pin(community))
  })

  it('builds in three stages and prunes the runtime tree to 150 MB', () => {
    expect(instructions).toMatch(/^FROM \$\{NODE_IMAGE\} AS build$/m)
    expect(instructions).toMatch(/^FROM build AS assemble$/m)
    expect(instructions).toMatch(/^FROM \$\{NODE_IMAGE\} AS runtime$/m)
    expect(instructions).toContain(
      'node scripts/prune-wardrobe-worker-deps.mjs --out /worker --max-node-modules-mb 150'
    )
    expect(instructions).toContain('COPY --from=assemble --chown=root:root /worker/ ./')
  })

  it('runs as the node user under tini as a subreaper, with the launcher as its CMD', () => {
    expect(instructions).toMatch(/^USER node$/m)
    expect(instructions).toContain('ENTRYPOINT ["/usr/bin/tini", "-s", "--"]')
    expect(instructions).toContain(
      'CMD ["node", "scripts/start-wardrobe-worker-production.mjs"]'
    )
    expect(instructions).toContain('tini openssl ca-certificates')
    expect(instructions).toMatch(/NODE_ENV=production/)
  })

  it('carries the database CA the launcher requires', () => {
    expect(instructions).toContain(
      'COPY --chown=root:root apps/api/certs/supabase-root-2021-ca.pem apps/api/certs/'
    )
  })

  it('proves the pruned tree and the launcher drill during the build', () => {
    expect(instructions).toMatch(
      /RUN GARMENT_TAGGING_ENGINE=manual WARDROBE_MAINTENANCE_ENABLED=true \\\n\s+node scripts\/start-wardrobe-worker-production\.mjs --self-test/
    )
  })

  it('installs and bakes no model, and never bakes the selectors', () => {
    expect(instructions).not.toMatch(
      /prepare-garment-tagging-model|prepare:tagging-model/
    )
    expect(instructions).not.toMatch(/GARMENT_TAGGING_MODEL_DIR/)
    expect(instructions).not.toMatch(/\n\s*(ENV|ARG)[^\n]*GARMENT_TAGGING_ENGINE/)
    expect(instructions).not.toMatch(/\n\s*(ENV|ARG)[^\n]*WARDROBE_MAINTENANCE_ENABLED/)
    expect(instructions).not.toMatch(/onnxruntime|transformers|tensorflow|nsfwjs/i)
  })

  it('records the commit it was built from, defaulting to the Northflank injection', () => {
    expect(instructions).toContain('ARG NF_GIT_SHA=unset')
    expect(instructions).toContain('ARG COMMIT_SHA=${NF_GIT_SHA}')
    expect(instructions).toContain('ENV WARDROBE_WORKER_COMMIT_SHA=${COMMIT_SHA}')
  })

  it('shares no file with the community image but the base pin and the CA', () => {
    expect(instructions).not.toContain('community')
    expect(community).not.toContain('wardrobe-worker')
  })
})

describe('start-wardrobe-worker-production.mjs', () => {
  it('starts only on the manual engine with maintenance on', async () => {
    const { startRefusal } = await load<LauncherModule>(
      'scripts/start-wardrobe-worker-production.mjs'
    )
    const ok = { GARMENT_TAGGING_ENGINE: 'manual', WARDROBE_MAINTENANCE_ENABLED: 'true' }
    expect(startRefusal(ok)).toBeNull()
    for (const engine of [undefined, '', 'fashion-clip', 'fixture', 'gpt-vision']) {
      expect(startRefusal({ ...ok, GARMENT_TAGGING_ENGINE: engine })).toMatch(
        /GARMENT_TAGGING_ENGINE=.* is refused/
      )
    }
    for (const maintenance of [undefined, '', 'false', '1']) {
      expect(startRefusal({ ...ok, WARDROBE_MAINTENANCE_ENABLED: maintenance })).toMatch(
        /WARDROBE_MAINTENANCE_ENABLED is not true/
      )
    }
  })

  it('lets only the drill child run with maintenance off, never with another engine', async () => {
    const { startRefusal, DRILL_ENV, DRILL_CHILD_ARGUMENT } = await load<LauncherModule>(
      'scripts/start-wardrobe-worker-production.mjs'
    )
    expect(DRILL_CHILD_ARGUMENT).toBe('--drill-child')
    expect(DRILL_ENV.WARDROBE_MAINTENANCE_ENABLED).toBe('false')
    expect(
      startRefusal(
        { GARMENT_TAGGING_ENGINE: 'manual', WARDROBE_MAINTENANCE_ENABLED: 'false' },
        { drillChild: true }
      )
    ).toBeNull()
    expect(
      startRefusal({ GARMENT_TAGGING_ENGINE: 'fashion-clip' }, { drillChild: true })
    ).not.toBeNull()
  })

  it('recognises a model runtime among loaded modules', async () => {
    const { loadedModelRuntimes } = await load<LauncherModule>(
      'scripts/start-wardrobe-worker-production.mjs'
    )
    expect(
      loadedModelRuntimes([
        '/app/node_modules/sharp/lib/index.js',
        '/app/node_modules/onnxruntime-node/dist/index.js',
        '/app/node_modules/@huggingface/transformers/src/transformers.js',
        '/app/apps/api/dist/src/modules/wardrobe/fashion-clip-tagging.engine.js',
      ])
    ).toEqual([
      '/app/node_modules/onnxruntime-node/dist/index.js',
      '/app/node_modules/@huggingface/transformers/src/transformers.js',
      '/app/apps/api/dist/src/modules/wardrobe/fashion-clip-tagging.engine.js',
    ])
    expect(loadedModelRuntimes(['/app/node_modules/bullmq/dist/index.js'])).toEqual([])
  })

  it('shuts down before the host grace period and reuses the community TLS refusal', () => {
    const launcher = read('scripts/start-wardrobe-worker-production.mjs')
    expect(launcher).toContain(
      "import { databaseTlsRefusal } from './start-community-worker-production.mjs'"
    )
    expect(launcher).toContain('export const SHUTDOWN_DEADLINE_MS = 25_000')
    expect(launcher).toContain("process.on('SIGTERM'")
    expect(launcher).toContain("process.on('SIGINT'")
  })
})

describe('prune-wardrobe-worker-deps.mjs', () => {
  it('traces the wardrobe bootstrap and both launchers, and no community entry', async () => {
    const { ENTRY_FILES } = await load<PruneModule>(
      'scripts/prune-wardrobe-worker-deps.mjs'
    )
    expect(ENTRY_FILES).toEqual([
      'apps/api/dist/src/workers/wardrobe.bootstrap.js',
      'scripts/start-wardrobe-worker-production.mjs',
      'scripts/start-community-worker-production.mjs',
    ])
    expect(ENTRY_FILES.join(' ')).not.toMatch(/community\.bootstrap|nsfw|screen/)
  })

  it('names the model and telemetry runtimes whose arrival fails the build', async () => {
    const { FORBIDDEN_PACKAGES, forbiddenPackagesIn } = await load<PruneModule>(
      'scripts/prune-wardrobe-worker-deps.mjs'
    )
    expect(FORBIDDEN_PACKAGES).toEqual(
      expect.arrayContaining([
        '@huggingface/transformers',
        'onnxruntime-node',
        '@tensorflow/tfjs-core',
        '@opentelemetry/sdk-node',
      ])
    )
    expect(forbiddenPackagesIn(['sharp', 'bullmq'])).toEqual([])
    expect(forbiddenPackagesIn(['sharp', 'onnxruntime-node'])).toEqual([
      'onnxruntime-node',
    ])
  })

  it('refuses to delete the checkout or a directory it did not assemble', async () => {
    const { outDirectoryRefusal } = await load<PruneModule>(
      'scripts/prune-wardrobe-worker-deps.mjs'
    )
    expect(outDirectoryRefusal(repoRoot)).toMatch(/checkout or a directory above/)
    expect(outDirectoryRefusal(path.join(repoRoot, 'apps'))).toMatch(
      /inside the checkout/
    )
  })

  it('leaves the community prune script and launcher unaware of the wardrobe worker', () => {
    expect(read('scripts/prune-community-worker-deps.mjs')).not.toMatch(/wardrobe-worker/)
    expect(read('scripts/start-community-worker-production.mjs')).not.toMatch(
      /wardrobe-worker/
    )
  })
})
