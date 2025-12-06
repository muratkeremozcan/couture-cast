import { Module } from '@nestjs/common'
import { Expo } from 'expo-server-sdk'

import { EXPO_CLIENT, PushNotificationService } from './push-notification.service'
import { PushTokenRepository } from './push-token.repository'

@Module({
  providers: [
    PushNotificationService,
    PushTokenRepository,
    {
      provide: EXPO_CLIENT,
      useFactory: () => new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN }),
    },
  ],
  exports: [PushNotificationService],
})
export class NotificationsModule {}
