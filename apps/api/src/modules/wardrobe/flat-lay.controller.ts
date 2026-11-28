import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UnprocessableEntityException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  FLAT_LAY_MAX_PHOTO_BYTES,
  flatLayConfirmInputSchema,
  flatLayConfirmResponseSchema,
  flatLayReviewResponseSchema,
} from '@couture/api-client/contracts/http'
import { AuthContext } from '../auth/security.decorators'
import { RequestAuthGuard } from '../auth/security.guards'
import type { RequestAuthContext } from '../auth/security.types'
import { WardrobeUploadGuard } from './wardrobe.guard'
import { FlatLayService } from './flat-lay.service'

@Controller('/api/v1/wardrobe/flat-lay')
@UseGuards(RequestAuthGuard, WardrobeUploadGuard)
export class FlatLayController {
  constructor(@Inject(FlatLayService) private readonly flatLay: FlatLayService) {}

  @Post('review')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: FLAT_LAY_MAX_PHOTO_BYTES + 1, files: 1, fields: 0, parts: 2 },
    })
  )
  async review(
    @AuthContext() auth: RequestAuthContext,
    @UploadedFile() photo?: { buffer: Buffer }
  ) {
    if (!photo?.buffer) throw new UnprocessableEntityException('FLAT_LAY_UNCERTAIN')
    if (photo.buffer.length > FLAT_LAY_MAX_PHOTO_BYTES)
      throw new PayloadTooLargeException()
    return flatLayReviewResponseSchema.parse(
      await this.flatLay.review(auth.userId, photo.buffer)
    )
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(@AuthContext() auth: RequestAuthContext, @Body() payload: unknown) {
    const parsed = flatLayConfirmInputSchema.safeParse(payload)
    if (!parsed.success) throw new BadRequestException('FLAT_LAY_INVALID')
    return flatLayConfirmResponseSchema.parse(
      await this.flatLay.confirm(auth, parsed.data)
    )
  }
}
