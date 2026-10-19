import type { PrismaClient } from '@prisma/client'

export declare function resetMobileE2EFlowState(
  prisma: PrismaClient,
  userId: string
): Promise<void>
