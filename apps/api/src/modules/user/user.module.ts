import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard } from '../auth/security.guards'
import { UserCacheHeadersMiddleware } from './user-cache-headers.middleware'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  imports: [PrismaModule, AuthStateModule],
  controllers: [UserController],
  providers: [UserService, RequestAuthGuard],
})
export class UserModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(UserCacheHeadersMiddleware).forRoutes({
      path: '/api/v1/user{/*path}',
      method: RequestMethod.ALL,
    })
  }
}
