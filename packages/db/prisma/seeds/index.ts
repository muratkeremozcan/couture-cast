import { PrismaClient } from '@prisma/client'

import { seedRituals } from './rituals.js'
import { seedUsers } from './users.js'
import { seedWardrobe } from './wardrobe.js'
import { seedWeather } from './weather.js'

const prisma = new PrismaClient()

async function main() {
  const users = await seedUsers(prisma)
  const garments = await seedWardrobe(prisma, users.teens)
  const weather = await seedWeather(prisma)
  await seedRituals(prisma, users.teens, garments, weather)
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
