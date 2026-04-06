import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common'
import { guardianConsentInputSchema } from '../../contracts/http'
import { AuthService } from './auth.service'
import { AuthContext, Roles } from './security.decorators'
import { RequestAuthGuard, RolesGuard } from './security.guards'
import type { RequestAuthContext } from './security.types'

@Controller('/api/v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('guardian-consent')
  @UseGuards(RequestAuthGuard, RolesGuard)
  @Roles('guardian', 'admin')
  grantGuardianConsent(
    @AuthContext() auth: RequestAuthContext,
    @Body() payload: unknown
  ) {
    const parsed = guardianConsentInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid guardian consent payload')
    }

    if (auth.role !== 'admin' && auth.userId !== parsed.data.guardianId) {
      throw new ForbiddenException('Authenticated guardian does not match guardianId')
    }

    return this.authService.grantGuardianConsent(parsed.data)
  }
}
