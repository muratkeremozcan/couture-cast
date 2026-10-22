// Story 6.5 owner: dedicated Fluid Compute HTTP-server export; REST retains 25 seconds.
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { AuthStateModule } from '../src/modules/auth/auth-state.module.js'
import { CommunityModule } from '../src/modules/community/community.module.js'
import { AccessTokenIdentityService } from '../src/modules/auth/access-token-identity.service.js'
import { CommunityAccessService } from '../src/modules/community/community-access.service.js'
import { CommunityStreamRepository } from '../src/modules/community/community-stream.repository.js'
import { resolveHttpCorsOrigins } from '../src/bootstrap/configure-app.js'
import {
  createCommunityRealtimeServer,
  type CommunityRealtimeDependencies,
} from '../src/realtime/community-realtime.server.js'

@Module({ imports: [AuthStateModule, CommunityModule] })
class CommunityRealtimeModule {}
let dependencies: Promise<CommunityRealtimeDependencies> | undefined
const runtime = createCommunityRealtimeServer(() => {
  dependencies ??= NestFactory.createApplicationContext(CommunityRealtimeModule, {
    logger: false,
  }).then((app) => ({
    release: async () => {
      dependencies = undefined
      await app.close()
    },
    prisma: app.get(PrismaClient),
    identity: app.get(AccessTokenIdentityService),
    access: app.get(CommunityAccessService),
    streams: app.get(CommunityStreamRepository),
    origins: resolveHttpCorsOrigins(),
  }))
  return dependencies
})
export default runtime.server
