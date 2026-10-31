// Story 6.9 G19, U-SHARE-CTRL: `FeatureFlagsModule` resolves in `ShareCardsModule`.
//
// The controller and service specs construct their classes by hand, so nothing in
// pr-tests compiled the real Nest graph: dropping `FeatureFlagsModule` from the imports
// (CommunityModule imports it but does not re-export it) stayed green until the API
// failed to boot.
//
// The graph is compiled in a child Node process. Vitest transforms TypeScript with
// esbuild, which never emits the `design:paramtypes` metadata Nest's injector reads, so
// `Test.createTestingModule` inside this worker cannot resolve a single class-typed
// constructor parameter. The child loads the sources through `ts.transpileModule` with
// `emitDecoratorMetadata`, the same per-file emit `nest build` produces, and every
// provider that would open a connection is overridden. Its environment is built from
// scratch with unroutable database and Redis URLs, so nothing can reach a real database.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const apiRoot = path.resolve(__dirname, '../../..')

/** CommonJS run by `node -e`; argv[1] is the API root. Prints one JSON line. */
const compileInChild = String.raw`
const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const apiRoot = process.argv[1]
const fromApi = (name) => require(require.resolve(name, { paths: [apiRoot] }))
const ts = fromApi('typescript')
// NodeNext sources import './x.js'; the file on disk is './x.ts'.
const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('.') && request.endsWith('.js') && parent && parent.filename) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts')
    if (fs.existsSync(source)) return source
  }
  return resolveFilename.call(this, request, parent, ...rest)
}
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  })
  module._compile(outputText, filename)
}
fromApi('reflect-metadata')
const { Test } = fromApi('@nestjs/testing')
const { PrismaClient } = fromApi('@prisma/client')
const load = (file) => require(path.join(apiRoot, 'src/modules', file))
const { ShareCardsModule } = load('share-cards/share-cards.module.ts')
const { ShareCardsService } = load('share-cards/share-cards.service.ts')
const { ShareCardsController } = load('share-cards/share-cards.controller.ts')
const { FeatureFlagsService } = load('feature-flags/feature-flags.service.ts')
const { CommunityModerationQueue } = load('community/community-moderation.queue.ts')
const { COMMUNITY_SPOTLIGHT_REDIS } = load('community/community-spotlight-cache.ts')
const { SupabaseCommunityStorageAdapter } = load('community/community-storage.adapter.ts')
;(async () => {
  let ref
  try {
    ref = await Test.createTestingModule({ imports: [ShareCardsModule] })
      // Any query through this stub fails with a TypeError instead of connecting.
      .overrideProvider(PrismaClient).useValue({})
      .overrideProvider(COMMUNITY_SPOTLIGHT_REDIS).useValue(null)
      .overrideProvider(CommunityModerationQueue).useValue({})
      .overrideProvider(SupabaseCommunityStorageAdapter).useValue({})
      .compile()
    const service = ref.get(ShareCardsService)
    console.log(JSON.stringify({
      compiled: true,
      service: service instanceof ShareCardsService,
      flags: ref.get(FeatureFlagsService) instanceof FeatureFlagsService,
      controller: ref.get(ShareCardsController) instanceof ShareCardsController,
      serviceFlags: Object.values(service).some((value) => value instanceof FeatureFlagsService),
    }))
  } catch (error) {
    console.log(JSON.stringify({ compiled: false, error: String(error && error.message).split('\n')[0] }))
  } finally {
    await ref?.close()
  }
})()
`

function compileShareCardsModule(): Record<string, unknown> {
  const output = execFileSync(process.execPath, ['-e', compileInChild, apiRoot], {
    cwd: apiRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      NODE_OPTIONS: '--conditions=development',
      ANALYTICS_ID_SECRET: 'share-cards-module-spec-placeholder-0000',
      DATABASE_URL: 'postgresql://offline.invalid:5432/none',
      REDIS_URL: 'redis://offline.invalid:6379',
    },
  })
  return JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
}

describe('ShareCardsModule wiring', () => {
  it('U-SHARE-CTRL compiles its real import graph and resolves the service and the flags', () => {
    expect(compileShareCardsModule()).toEqual({
      compiled: true,
      service: true,
      flags: true,
      controller: true,
      serviceFlags: true,
    })
  }, 90_000)
})
