import { Module } from '@nestjs/common'

import { ConnectionManager } from './connection-manager.service'
import { EventsGateway, gatewayLoggerProvider } from './gateway.gateway'

@Module({
  providers: [EventsGateway, ConnectionManager, gatewayLoggerProvider],
})
export class GatewayModule {}
