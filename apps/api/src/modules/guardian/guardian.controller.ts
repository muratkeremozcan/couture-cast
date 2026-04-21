import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import {
  guardianConsentRevokeInputSchema,
  guardianInvitationAcceptInputSchema,
  guardianInvitationInputSchema,
} from '../../contracts/http'
import { AuthContext, Roles } from '../auth/security.decorators'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { GuardianService } from './guardian.service'

function getClientIp(request: Request): string | undefined {
  const forwardedFor = request.headers['x-forwarded-for']
  const rawForwardedFor = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  const clientIp = rawForwardedFor?.split(',')[0]?.trim()

  return clientIp || request.ip
}

@Controller('/api/v1/guardian')
export class GuardianController {
  constructor(
    @Inject(GuardianService) private readonly guardianService: GuardianService
  ) {}

  @Post('invitations')
  inviteGuardian(@Body() payload: unknown) {
    const parsed = guardianInvitationInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid guardian invitation payload')
    }

    return this.guardianService.inviteGuardian(
      parsed.data.teenId,
      parsed.data.guardianEmail,
      parsed.data.consentLevel
    )
  }

  @Post('accept')
  @HttpCode(200)
  acceptInvitation(@Body() payload: unknown, @Req() request: Request) {
    const parsed = guardianInvitationAcceptInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid guardian invitation accept payload')
    }

    return this.guardianService.acceptInvitation(parsed.data.token, getClientIp(request))
  }

  @Post('revoke')
  @HttpCode(200)
  @UseGuards(RequestAuthGuard, RolesGuard)
  @Roles('guardian', 'admin')
  revokeConsent(
    @AuthContext() auth: RequestAuthContext,
    @Body() payload: unknown,
    @Req() request: Request
  ) {
    const parsed = guardianConsentRevokeInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid guardian consent revoke payload')
    }

    if (auth.role !== 'admin' && auth.userId !== parsed.data.guardianId) {
      throw new ForbiddenException('Authenticated guardian does not match guardianId')
    }

    return this.guardianService.revokeConsent(
      parsed.data.guardianId,
      parsed.data.teenId,
      getClientIp(request)
    )
  }
}
