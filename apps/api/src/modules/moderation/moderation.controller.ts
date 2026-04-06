import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common'
import { moderationActionInputSchema } from '../../contracts/http'
import { AuthContext, Roles } from '../auth/security.decorators'
import { RequestAuthGuard, RolesGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { ModerationService } from './moderation.service'

@Controller('/api/v1/moderation')
export class ModerationController {
  constructor(
    @Inject(ModerationService) private readonly moderationService: ModerationService
  ) {}

  @Post('actions')
  @UseGuards(RequestAuthGuard, RolesGuard)
  @Roles('moderator', 'admin')
  recordAction(@AuthContext() auth: RequestAuthContext, @Body() payload: unknown) {
    const parsed = moderationActionInputSchema.safeParse(payload)
    if (!parsed.success) {
      throw new BadRequestException('Invalid moderation action payload')
    }

    if (auth.role !== 'admin' && auth.userId !== parsed.data.moderatorId) {
      throw new ForbiddenException('Authenticated moderator does not match moderatorId')
    }

    return this.moderationService.recordAction(parsed.data)
  }
}
