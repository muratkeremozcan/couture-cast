// Step 3 step 2 owner: searchable owner anchor
import { PrismaClient } from '@prisma/client'
import * as factoryModule from '../../../testing/src/factories/factory.ts'

import { seedCommerceCatalog, seedPremiumEntitlements } from './commerce.js'
import { seedFeatureFlags } from './feature-flags.js'
import { unwrapCjsNamespace } from './interop.js'
import { seedRituals } from './rituals.js'
import { seedUsers } from './users.js'
import { seedWardrobeItems } from './wardrobe.js'
import { seedWeather } from './weather.js'

const prisma = new PrismaClient()
const { faker } = unwrapCjsNamespace(factoryModule)

async function main() {
  faker.seed(4242)

  const users = await seedUsers(prisma)
  const garments = await seedWardrobeItems(prisma, users.teens)
  const weather = await seedWeather(prisma)
  await seedRituals(prisma, users.teens, garments, weather)
  await seedFeatureFlags(prisma)
  // Story 5.1 decision 14. Self-guarded: a no-op outside non-production, so it
  // is safe to call unconditionally here.
  await seedCommerceCatalog(prisma)
  // Story 5.2 decision 9. Same self-guard.
  await seedPremiumEntitlements(prisma)
}

main()
  .then(async () => {
    await prisma.$disconnect()
    console.log('Seed data applied')
  })
  .catch(async (e) => {
    console.error('Seed failed', e)
    await prisma.$disconnect()
    process.exit(1)
  })
