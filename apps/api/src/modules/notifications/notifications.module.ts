import { Module } from '@nestjs/common'

import { PushNotificationService } from './push-notification.service'
import { PushTokenRepository } from './push-token.repository'

@Module({
  providers: [PushNotificationService, PushTokenRepository],
  exports: [PushNotificationService],
})
export class NotificationsModule {}
