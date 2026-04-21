import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { AuthStateModule } from '../auth/auth-state.module'
import { RequestAuthGuard } from '../auth/security.guards'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  imports: [PrismaModule, AuthStateModule],
  controllers: [UserController],
  providers: [UserService, RequestAuthGuard],
})
export class UserModule {}
