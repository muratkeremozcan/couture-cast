// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Hosted wardrobe workers and manual tagging.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#hosted-wardrobe-workers-and-manual-tagging
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  ScriptTarget,
  createSourceFile,
  forEachChild,
  isExportDeclaration,
  isImportDeclaration,
  type StringLiteral,
} from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualGarmentTaggingEngine } from '../modules/wardrobe/manual-garment-tagging.engine'
import { FixtureSilhouettePhotoModerationEngine } from '../modules/wardrobe/fixture-silhouette-photo-moderation.engine'
import { HeuristicSilhouettePhotoModerationEngine } from '../modules/wardrobe/heuristic-silhouette-photo-moderation.engine'
import {
  classifySilhouetteProcessingFailure,
  createSilhouetteModerationEngine,
  createTaggingEngine,
} from './wardrobe.bootstrap'

/** Counts how often the FashionCLIP engine module is evaluated; manual mode must never do it. */
const fashionClip = vi.hoisted(() => ({ loads: 0, ready: vi.fn() }))
vi.mock('../modules/wardrobe/fashion-clip-tagging.engine', () => {
  fashionClip.loads += 1
  return {
    FashionClipTaggingEngine: class {
      ensureReady = fashionClip.ready
    },
  }
})

/**
 * Risk 4.4-R01. BullMQ distributes a queue's jobs across every Worker
 * subscribed to that queue name, in any process. Two bootstraps subscribing to
 * `moderation-review` therefore split the jobs between them, and the process
 * that has no silhouette processor "succeeds" its share without ever running
 * moderation -- silently, with no failed job to alert on.
 *
 * A runtime test cannot observe this: each bootstrap only registers its worker
 * inside `require.main === module`, and standing up both process groups against
 * real Redis to count consumers would be far more fragile than the invariant is
 * worth. The invariant is structural, so it is asserted structurally.
 */
describe('moderation-review consumer registration', () => {
  it('4.4-UNIT-15 is registered by exactly one worker bootstrap', () => {
    const workersDir = path.resolve(__dirname)
    const registrations = readdirSync(workersDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter((file) =>
        /createWorker\(\s*'moderation-review'/.test(
          readFileSync(path.join(workersDir, file), 'utf8')
        )
      )

    expect(registrations).toEqual(['wardrobe.bootstrap.ts'])
  })
})

// TEA sign-off F-4: the wardrobe worker starts only inside `require.main === module`, so its
// boot refusal is asserted structurally like the registration above.
describe('U-W-POLICY: wardrobe worker guardian consent policy', () => {
  it('resolves the policy before it opens a queue', () => {
    const source = readFileSync(path.resolve(__dirname, 'wardrobe.bootstrap.ts'), 'utf8')
    const start = source.slice(source.indexOf('async function startWardrobeWorker()'))
    const resolved = start.indexOf('resolveGuardianConsentPolicy()')
    expect(resolved).toBeGreaterThan(-1)
    expect(resolved).toBeLessThan(start.indexOf('createQueues()'))
  })
})

describe('classifySilhouetteProcessingFailure', () => {
  it.each([
    [new Error('Request timeout after 30s'), 'timeout'],
    [new Error('operation timed out'), 'timeout'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'timeout'],
    [Object.assign(new Error('slow'), { name: 'TimeoutError' }), 'timeout'],
    [new Error('connection reset'), 'storage_error'],
    ['not-an-error', 'storage_error'],
    [undefined, 'storage_error'],
  ])('4.4-UNIT-16 classifies %o as %s', (error, expected) => {
    expect(classifySilhouetteProcessingFailure(error)).toBe(expected)
  })
})

describe('createSilhouetteModerationEngine', () => {
  const originalEngine = process.env.SILHOUETTE_MODERATION_ENGINE
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestEnv = process.env.TEST_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    if (originalEngine === undefined) delete process.env.SILHOUETTE_MODERATION_ENGINE
    else process.env.SILHOUETTE_MODERATION_ENGINE = originalEngine
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalTestEnv === undefined) delete process.env.TEST_ENV
    else process.env.TEST_ENV = originalTestEnv
  })

  it('4.4-UNIT-16 defaults to the heuristic engine', () => {
    delete process.env.SILHOUETTE_MODERATION_ENGINE
    expect(createSilhouetteModerationEngine()).toBeInstanceOf(
      HeuristicSilhouettePhotoModerationEngine
    )
  })

  it('4.4-UNIT-16 builds the fixture engine only inside an allowed test environment', () => {
    process.env.SILHOUETTE_MODERATION_ENGINE = 'fixture'
    expect(createSilhouetteModerationEngine()).toBeInstanceOf(
      FixtureSilhouettePhotoModerationEngine
    )

    delete process.env.NODE_ENV
    delete process.env.TEST_ENV
    expect(() => createSilhouetteModerationEngine()).toThrow(
      'forbidden outside test environments'
    )
  })

  it('4.4-UNIT-16 refuses an unrecognized engine name rather than falling back', () => {
    process.env.SILHOUETTE_MODERATION_ENGINE = 'gpt-vision'
    expect(() => createSilhouetteModerationEngine()).toThrow(
      'Unsupported SILHOUETTE_MODERATION_ENGINE value: gpt-vision'
    )
  })
})

describe('U-W-QUEUES: which bootstrap consumes which queue', () => {
  const workersDir = path.resolve(__dirname)
  const sources = readdirSync(workersDir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => ({ file, text: readFileSync(path.join(workersDir, file), 'utf8') }))
  const registrations = (queue: string) =>
    sources
      .filter(({ text }) => new RegExp(`createWorker\\(\\s*'${queue}'`).test(text))
      .map(({ file }) => file)

  it.each(['color-extraction', 'palette-analysis'])(
    'registers %s in the wardrobe bootstrap only',
    (queue) => {
      expect(registrations(queue)).toEqual(['wardrobe.bootstrap.ts'])
    }
  )

  it('registers maintenance in the general bootstrap and, behind its own flag, the wardrobe bootstrap', () => {
    expect(registrations('maintenance')).toEqual([
      'bootstrap.ts',
      'wardrobe.bootstrap.ts',
    ])
    const wardrobe = readFileSync(path.join(workersDir, 'wardrobe.bootstrap.ts'), 'utf8')
    expect(wardrobe).toMatch(
      /if \(wardrobeMaintenanceEnabled\(\)\) \{\s+await startWardrobeMaintenance\(/
    )
  })

  it('starts no weather, alert, billing or community consumer in the wardrobe bootstrap', () => {
    const wardrobe = readFileSync(path.join(workersDir, 'wardrobe.bootstrap.ts'), 'utf8')
    for (const queue of [
      'weather-ingestion',
      'alert-fanout',
      'billing-reconciliation',
      'community-moderation',
    ]) {
      expect(wardrobe).not.toContain(`createWorker('${queue}'`)
    }
    expect(wardrobe).not.toMatch(
      /community-worker-runtime|registerMaintenanceSchedulers\(/
    )
  })

  it('gives every wardrobe consumer the hosted options and none its own concurrency', () => {
    const wardrobe = readFileSync(path.join(workersDir, 'wardrobe.bootstrap.ts'), 'utf8')
    expect(wardrobe.match(/hostedWorkerOptions\(\)/g)).toHaveLength(4)
    expect(wardrobe).not.toMatch(/defaultWorkerOptions|limiter:/)
  })

  it('names the queues it consumes in its startup log', () => {
    const wardrobe = readFileSync(path.join(workersDir, 'wardrobe.bootstrap.ts'), 'utf8')
    expect(wardrobe).toMatch(
      /Dedicated wardrobe worker started, consuming \$\{workers\.map\(\(worker\) => worker\.name\)\.join\(', '\)\}/
    )
  })
})

describe('U-W-IMPORTS: the manual worker loads no model runtime', () => {
  /** Static import and re-export edges only; a dynamic `import()` is the lazy path under test. */
  function staticGraph(entry: string) {
    const files = new Set<string>()
    const packages = new Set<string>()
    const queue = [entry]
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (files.has(file)) continue
      files.add(file)
      const source = createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ScriptTarget.Latest,
        true
      )
      source.forEachChild(function visit(node) {
        const isImport = isImportDeclaration(node) && !node.importClause?.isTypeOnly
        const isExport = isExportDeclaration(node) && !node.isTypeOnly
        if ((isImport || isExport) && node.moduleSpecifier) {
          const specifier = (node.moduleSpecifier as StringLiteral).text
          if (specifier.startsWith('.')) {
            const base = path.join(path.dirname(file), specifier).replace(/\.js$/, '')
            const resolved = [`${base}.ts`, path.join(base, 'index.ts')].find(
              (candidate) => {
                try {
                  readFileSync(candidate)
                  return true
                } catch {
                  return false
                }
              }
            )
            if (resolved) queue.push(resolved)
          } else {
            packages.add(
              specifier.startsWith('@')
                ? specifier.split('/').slice(0, 2).join('/')
                : (specifier.split('/')[0] as string)
            )
          }
          return
        }
        forEachChild(node, visit)
      })
    }
    return { files, packages }
  }

  const { files, packages } = staticGraph(
    path.resolve(__dirname, 'wardrobe.bootstrap.ts')
  )

  it('statically imports neither the FashionCLIP engine nor onnxruntime, transformers, TensorFlow or the OpenTelemetry SDK', () => {
    const names = [...files].map((file) => path.basename(file))
    expect(names).not.toContain('fashion-clip-tagging.engine.ts')
    expect(names).not.toContain('fashion-clip-inference.worker.ts')
    for (const heavy of [
      '@huggingface/transformers',
      'onnxruntime-node',
      'onnxruntime-web',
      '@tensorflow/tfjs-core',
      'nsfwjs',
      '@opentelemetry/sdk-node',
      '@opentelemetry/auto-instrumentations-node',
    ]) {
      expect(packages.has(heavy), heavy).toBe(false)
    }
  })

  it("reaches the FashionCLIP engine only through createTaggingEngine's dynamic import", () => {
    const source = readFileSync(path.resolve(__dirname, 'wardrobe.bootstrap.ts'), 'utf8')
    expect(source).toMatch(
      /await import\(\s*'\.\.\/modules\/wardrobe\/fashion-clip-tagging\.engine\.js'\s*\)/
    )
  })
})

describe('createTaggingEngine', () => {
  const original = {
    engine: process.env.GARMENT_TAGGING_ENGINE,
    dir: process.env.GARMENT_TAGGING_MODEL_DIR,
    nodeEnv: process.env.NODE_ENV,
    testEnv: process.env.TEST_ENV,
  }

  beforeEach(() => {
    fashionClip.loads = 0
    fashionClip.ready.mockReset().mockResolvedValue(undefined)
    delete process.env.GARMENT_TAGGING_MODEL_DIR
  })

  afterEach(() => {
    for (const [key, value] of [
      ['GARMENT_TAGGING_ENGINE', original.engine],
      ['GARMENT_TAGGING_MODEL_DIR', original.dir],
      ['NODE_ENV', original.nodeEnv],
      ['TEST_ENV', original.testEnv],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('selects the manual engine in production without loading the FashionCLIP module', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TEST_ENV
    process.env.GARMENT_TAGGING_ENGINE = 'manual'

    const engine = await createTaggingEngine()

    expect(engine).toBeInstanceOf(ManualGarmentTaggingEngine)
    expect(fashionClip.loads).toBe(0)
    await expect(engine.inferTags(Buffer.from('x'))).rejects.toMatchObject({
      code: 'TAGGING_MANUAL_MODE',
    })
  })

  it('keeps fashion-clip selectable and loads its module only then', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TEST_ENV
    process.env.GARMENT_TAGGING_ENGINE = 'fashion-clip'
    process.env.GARMENT_TAGGING_MODEL_DIR = '/models/garment-tagging'

    await createTaggingEngine()

    expect(fashionClip.loads).toBe(1)
    expect(fashionClip.ready).toHaveBeenCalledOnce()
  })

  it('still refuses fashion-clip in production without a model directory', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TEST_ENV
    process.env.GARMENT_TAGGING_ENGINE = 'fashion-clip'

    await expect(createTaggingEngine()).rejects.toThrow('GARMENT_TAGGING_MODEL_DIR')
    expect(fashionClip.loads).toBe(0)
  })

  it('still refuses the fixture engine outside test environments', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.TEST_ENV
    process.env.GARMENT_TAGGING_ENGINE = 'fixture'

    await expect(createTaggingEngine()).rejects.toThrow(
      'forbidden outside test environments'
    )
  })

  it('still refuses an unknown engine rather than falling back', async () => {
    process.env.GARMENT_TAGGING_ENGINE = 'gpt-vision'
    await expect(createTaggingEngine()).rejects.toThrow(
      'Unsupported GARMENT_TAGGING_ENGINE value: gpt-vision'
    )
  })
})
