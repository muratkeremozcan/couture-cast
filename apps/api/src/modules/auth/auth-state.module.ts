import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AccessTokenIdentityService } from './access-token-identity.service.js'
import { GuardianConsentStateService } from './guardian-consent-state.service'
import { UserSessionService } from './user-session.service'

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    AccessTokenIdentityService,
    GuardianConsentStateService,
    UserSessionService,
  ],
  exports: [AccessTokenIdentityService, GuardianConsentStateService, UserSessionService],
})
export class AuthStateModule {}
