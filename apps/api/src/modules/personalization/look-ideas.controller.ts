import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common'
import { lookIdeasInputSchema, type LookIdeasResponse } from '../../contracts/http.js'
import { LOOK_IDEAS_ROUTE } from '../../logger/request-context.js'
import { AuthContext, RequireActiveTeenAccount } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import { LookIdeasService } from './look-ideas.service.js'

@Controller(LOOK_IDEAS_ROUTE)
@UseGuards(RequestAuthGuard)
@RequireActiveTeenAccount()
export class LookIdeasController {
  constructor(@Inject(LookIdeasService) private readonly service: LookIdeasService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async generate(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown
  ): Promise<LookIdeasResponse> {
    const parsed = lookIdeasInputSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('Invalid outfit preferences')
    return { data: await this.service.generate(auth.userId, parsed.data) }
  }
}
