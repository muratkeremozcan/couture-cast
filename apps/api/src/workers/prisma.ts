import { PrismaClient } from '@prisma/client'

// Singleton Prisma client for worker processes
let prisma: PrismaClient | null = null

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient()
  }
  return prisma
}
