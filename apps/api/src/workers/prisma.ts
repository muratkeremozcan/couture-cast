import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from '../prisma/prisma-client.js'

// Singleton Prisma client for worker processes
let prisma: PrismaClient | null = null

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = createPrismaClient()
  }
  return prisma
}

export async function disconnectPrismaClient(): Promise<void> {
  if (!prisma) {
    return
  }

  await prisma.$disconnect()
  prisma = null
}
