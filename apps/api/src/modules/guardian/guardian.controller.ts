import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Ip,
  Post,
} from '@nestjs/common'
import {
  guardianInvitationAcceptInputSchema,
  guardianInvitationInputSchema,
} from '../../contracts/http'
import { GuardianService } from './guardian.service'

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
  acceptInvitation(@Body() payload: unknown, @Ip() ipAddress: string) {
    const parsed = guardianInvitationAcceptInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid guardian invitation accept payload')
    }

    return this.guardianService.acceptInvitation(parsed.data.token, ipAddress)
  }
}
