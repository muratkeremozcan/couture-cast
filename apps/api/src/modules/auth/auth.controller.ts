import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import {
  federatedSignupInputSchema,
  guardianConsentInputSchema,
  signupInputSchema,
} from '../../contracts/http'
import { AuthService } from './auth.service'
import { AuthContext, Roles } from './security.decorators'
import { parseBearerToken, RequestAuthGuard, RolesGuard } from './security.guards'

/**
 * Story 6.17 D3: the federated endpoints act on a Supabase identity that has no app account
 * yet, so they take the raw bearer instead of RequestAuthGuard's app identity.
 */
function requireBearer(authorization: string | string[] | undefined) {
  const token = parseBearerToken(authorization)
  if (!token) throw new UnauthorizedException('Missing bearer token')
  return token
}
import type { RequestAuthContext } from './security.types'

@Controller('/api/v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('signup')
  signUp(@Body() payload: unknown) {
    const parsed = signupInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid signup payload')
    }

    return this.authService.signUp(parsed.data)
  }

  @Get('signup/federated')
  federatedSignupStatus(@Headers('authorization') authorization?: string | string[]) {
    return this.authService.getFederatedSignupStatus(requireBearer(authorization))
  }

  @Post('signup/federated')
  signUpFederated(
    @Headers('authorization') authorization: string | string[] | undefined,
    @Body() payload: unknown
  ) {
    const token = requireBearer(authorization)
    const parsed = federatedSignupInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid signup payload')
    }
    return this.authService.signUpFederated(token, parsed.data)
  }

  @Delete('signup/federated')
  @HttpCode(204)
  async abandonFederatedSignup(
    @Headers('authorization') authorization?: string | string[]
  ): Promise<void> {
    await this.authService.abandonFederatedSignup(requireBearer(authorization))
  }

  @Post('guardian-consent')
  @HttpCode(200)
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
