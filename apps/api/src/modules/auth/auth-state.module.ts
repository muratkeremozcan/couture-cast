import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { GuardianConsentStateService } from './guardian-consent-state.service'
import { UserSessionService } from './user-session.service'

@Global()
@Module({
  imports: [PrismaModule],
  providers: [GuardianConsentStateService, UserSessionService],
  exports: [GuardianConsentStateService, UserSessionService],
})
export class AuthStateModule {}
