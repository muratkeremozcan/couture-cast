import { Controller, Get, Inject, UseGuards, Put, Body } from '@nestjs/common'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { UserService } from './user.service'
import {
  userPreferencesInputSchema,
  userPreferencesResponseSchema,
  type UserPreferencesInput,
} from '../../contracts/http.js'
import { toBadRequest } from '../../controllers/error-helpers.js'

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

  @Put('preferences')
  @UseGuards(RequestAuthGuard)
  async updatePreferences(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown
  ) {
    let parsedBody: UserPreferencesInput
    try {
      parsedBody = userPreferencesInputSchema.parse(body)
    } catch (error) {
      return toBadRequest(error)
    }

    const result = await this.userService.updatePreferences(auth.userId, parsedBody)
    return userPreferencesResponseSchema.parse(result)
  }
}
