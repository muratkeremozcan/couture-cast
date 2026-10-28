import { Global, Module } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { createPrismaClient } from './prisma-client.js'

const prisma = createPrismaClient()

@Global()
@Module({
  providers: [{ provide: PrismaClient, useValue: prisma }],
  exports: [PrismaClient],
})
export class PrismaModule {}
