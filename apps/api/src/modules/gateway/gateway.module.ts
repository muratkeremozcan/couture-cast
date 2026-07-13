import { Module } from '@nestjs/common'

import { AuthStateModule } from '../auth/auth-state.module.js'
import {
  AlertWeatherRelayService,
  alertWeatherRedisSubscriberProvider,
} from './alert-weather-relay.service.js'
import { ConnectionManager } from './connection-manager.service'
import {
  AlertWeatherGateway,
  EventsGateway,
  gatewayLoggerProvider,
} from './gateway.gateway'

@Module({
  imports: [AuthStateModule],
  providers: [
    AlertWeatherGateway,
    AlertWeatherRelayService,
    ConnectionManager,
    EventsGateway,
    alertWeatherRedisSubscriberProvider,
    gatewayLoggerProvider,
  ],
})
export class GatewayModule {}
