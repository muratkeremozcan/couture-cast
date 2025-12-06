import { Module } from '@nestjs/common'

import { EventsGateway } from './gateway.gateway'

@Module({
  providers: [EventsGateway],
})
export class GatewayModule {}
