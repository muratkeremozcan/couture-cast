import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { UserService } from './user.service'

// Story 0.9 Task 5 step 5 owner:
// expose the authenticated user REST slice here as a thin adapter over the shared contract-backed
// service layer.
@Controller('/api/v1/user')
export class UserController {
  constructor(@Inject(UserService) private readonly userService: UserService) {}

  @Get('profile')
  @UseGuards(RequestAuthGuard)
  getProfile(@AuthContext() auth: RequestAuthContext) {
    return this.userService.getProfile(auth)
  }
}
