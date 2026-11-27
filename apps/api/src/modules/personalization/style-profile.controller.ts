import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Patch,
  UseGuards,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import {
  styleProfileResponseSchema,
  updateStyleProfileInputSchema,
  type StyleProfileResponse,
} from '../../contracts/http.js'
import { toBadRequest } from '../../controllers/error-helpers.js'
import { AllowPendingGuardianTeen, AuthContext } from '../auth/security.decorators.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import type { RequestAuthContext } from '../auth/security.types.js'

const fields = {
  mood: true,
  palette: true,
  texture: true,
  fit: true,
  avoid: true,
} as const

function emptyResponse(): StyleProfileResponse {
  return { data: { mood: null, palette: null, texture: null, fit: null, avoid: [] } }
}

@Controller('/api/v1/personalization/style-profile')
@UseGuards(RequestAuthGuard)
@AllowPendingGuardianTeen()
export class StyleProfileController {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async read(@AuthContext() auth: RequestAuthContext): Promise<StyleProfileResponse> {
    const data = await this.prisma.styleProfile.findUnique({
      where: { user_id: auth.userId },
      select: fields,
    })
    return data ? styleProfileResponseSchema.parse({ data }) : emptyResponse()
  }

  @Patch()
  @Header('Cache-Control', 'private, no-store')
  async update(
    @AuthContext() auth: RequestAuthContext,
    @Body() body: unknown
  ): Promise<StyleProfileResponse> {
    const parsed = updateStyleProfileInputSchema.safeParse(body)
    if (!parsed.success) return toBadRequest(parsed.error)
    if (Object.keys(parsed.data).length === 0) return this.read(auth)

    const data = await this.prisma.styleProfile.upsert({
      where: { user_id: auth.userId },
      create: { user_id: auth.userId, ...parsed.data },
      update: parsed.data,
      select: fields,
    })
    return styleProfileResponseSchema.parse({ data })
  }

  @Delete()
  @Header('Cache-Control', 'private, no-store')
  async clear(@AuthContext() auth: RequestAuthContext): Promise<StyleProfileResponse> {
    await this.prisma.styleProfile.deleteMany({ where: { user_id: auth.userId } })
    return emptyResponse()
  }
}
