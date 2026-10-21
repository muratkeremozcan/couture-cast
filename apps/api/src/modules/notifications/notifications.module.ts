import { AuthStateModule } from '../auth/auth-state.module.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { PushRegistrationService } from './push-registration.service.js'
import { PushRegistrationController } from './push-registration.controller.js'
import { Module } from '@nestjs/common'
import { Expo } from 'expo-server-sdk'
import { PrismaModule } from '../../prisma/prisma.module'

import { EXPO_CLIENT, PushNotificationService } from './push-notification.service'
import { PushTokenRepository } from './push-token.repository'

@Module({
  imports: [PrismaModule, AuthStateModule],
  controllers: [PushRegistrationController],
  providers: [
    RequestAuthGuard,
    PushRegistrationService,
    PushNotificationService,
    PushTokenRepository,
    {
      provide: EXPO_CLIENT,
      useFactory: () => new Expo({ accessToken: process.env.EXPO_PUSH_ACCESS_TOKEN }),
    },
  ],
  exports: [PushNotificationService],
})
export class NotificationsModule {}
