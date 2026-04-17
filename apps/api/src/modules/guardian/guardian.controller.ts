import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'
import {
  guardianInvitationAcceptInputSchema,
  guardianInvitationInputSchema,
} from '../../contracts/http'
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
}
