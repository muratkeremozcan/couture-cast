/**
 * Not a test. A probe that `seed-graph-instantiation.spec.ts` runs in a real
 * `tsx` subprocess, because the failure it guards against exists only there.
 *
 * `prisma db seed` runs `tsx prisma/seeds/index.ts`, and `index.ts` imports
 * `testing/src/factories/factory.ts` BEFORE it imports `./commerce.js`. That
 * factory source `require`s `@couture/utils`, which puts the package in the
 * CommonJS require cache; Node then builds that module's ESM facade from the
 * cached CommonJS object rather than letting cjs-module-lexer read the source,
 * and the facade carries only `default` and `module.exports`. Any seed module
 * that reaches `@couture/utils` through a NAMED import after that point throws
 * `does not provide an export named ...` at instantiation time, before a line
 * of seed code runs.
 *
 * Nothing else in the repository sees it. Vitest resolves `@couture/utils`
 * through its own bundler resolution, so `commerce-seed.spec.ts` imports the
 * very same module and passes; so does `typecheck`, which reads
 * `../utils/dist/index.d.ts`. Story 5.4 shipped exactly that named import and
 * took the whole mobile E2E matrix, the Playwright burn-in and the k6 smoke
 * down at `db:reset` while every unit and integration suite stayed green.
 *
 * The import order below therefore MIRRORS `prisma/seeds/index.ts` and is the
 * point of the file: reordering it to put the seed modules first would make the
 * probe pass against the broken code it exists to catch.
 */
import * as factoryModule from '../../../testing/src/factories/factory.ts'

import {
  SAMPLE_PARTNER_SLUG,
  seedAdvisorOfferCatalog,
  seedCommerceCatalog,
  seedPaletteAdvisorWardrobe,
  seedPremiumEntitlements,
} from '../../prisma/seeds/commerce.js'
import { seedFeatureFlags } from '../../prisma/seeds/feature-flags.js'
import { seedRituals } from '../../prisma/seeds/rituals.js'
import { seedUsers } from '../../prisma/seeds/users.js'
import { seedWardrobeItems } from '../../prisma/seeds/wardrobe.js'
import { seedWeather } from '../../prisma/seeds/weather.js'

/**
 * Every binding is reported by TYPE rather than merely being imported. An
 * import alone proves instantiation; reading each binding proves the ESM facade
 * actually carried it, which is the half that broke.
 */
const bindings = {
  factoryExportCount: Object.keys(factoryModule).length,
  samplePartnerSlug: typeof SAMPLE_PARTNER_SLUG,
  seedAdvisorOfferCatalog: typeof seedAdvisorOfferCatalog,
  seedCommerceCatalog: typeof seedCommerceCatalog,
  seedFeatureFlags: typeof seedFeatureFlags,
  seedPaletteAdvisorWardrobe: typeof seedPaletteAdvisorWardrobe,
  seedPremiumEntitlements: typeof seedPremiumEntitlements,
  seedRituals: typeof seedRituals,
  seedUsers: typeof seedUsers,
  seedWardrobeItems: typeof seedWardrobeItems,
  seedWeather: typeof seedWeather,
}

process.stdout.write(JSON.stringify(bindings))
