import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common'
import sharp from 'sharp'
import {
  FLAT_LAY_MAX_MASK_BYTES,
  FLAT_LAY_MAX_PIECES,
  FLAT_LAY_REVIEW_LIFETIME_MS,
  type FlatLayConfirmation,
  type FlatLayReview,
  type FlatLaySelection,
} from '@couture/api-client/contracts/http'
import type { RequestAuthContext } from '../auth/security.types'
import { requireAnalyticsIdSecret } from '../telemetry/telemetry.service'
import { FlatLayDetector } from './flat-lay-detector'
import { WardrobeService } from './wardrobe.service'

type MaskGrant = {
  reviewId: string
  reviewItems: string[]
  itemId: string
  expiresAt: number
  sha256: string
}

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

function signingKey() {
  return createHmac('sha256', requireAnalyticsIdSecret())
    .update('couture/wardrobe/flat-lay-mask/v1')
    .digest()
}

function signature(key: Buffer, userId: string, payload: string) {
  return createHmac('sha256', key)
    .update(JSON.stringify([userId, payload]))
    .digest()
}

function issueToken(key: Buffer, userId: string, grant: MaskGrant) {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url')
  return `${payload}.${signature(key, userId, payload).toString('base64url')}`
}

function invalid(): never {
  throw new BadRequestException('FLAT_LAY_INVALID')
}

function verifyToken(key: Buffer, userId: string, token: string): MaskGrant {
  const [payload, tag, extra] = token.split('.')
  if (!payload || !tag || extra !== undefined) invalid()
  const provided = Buffer.from(tag, 'base64url')
  const expected = signature(key, userId, payload)
  if (
    tag !== provided.toString('base64url') ||
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    invalid()
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MaskGrant
}

async function maskDimensions(bytes: Buffer) {
  const metadata = await sharp(bytes, { limitInputPixels: 700 ** 2 })
    .metadata()
    .catch(invalid)
  if (
    metadata.format !== 'webp' ||
    (metadata.pages ?? 1) !== 1 ||
    !metadata.hasAlpha ||
    metadata.exif ||
    metadata.iptc ||
    metadata.icc ||
    metadata.xmp ||
    !metadata.width ||
    !metadata.height
  )
    invalid()
  return { widthPx: metadata.width, heightPx: metadata.height }
}

@Injectable()
export class FlatLayService {
  constructor(
    @Inject(FlatLayDetector) private readonly detector: FlatLayDetector,
    @Inject(WardrobeService) private readonly wardrobe: WardrobeService
  ) {}

  async review(userId: string, photo: Buffer): Promise<FlatLayReview> {
    const result = await this.detector.detect(photo)
    if (result.kind === 'person')
      throw new UnprocessableEntityException('FLAT_LAY_PERSON')
    if (
      result.kind === 'uncertain' ||
      result.items.length < 2 ||
      result.items.length > FLAT_LAY_MAX_PIECES ||
      result.items.some(
        ({ bytes }) => bytes.length === 0 || bytes.length > FLAT_LAY_MAX_MASK_BYTES
      )
    )
      throw new UnprocessableEntityException('FLAT_LAY_UNCERTAIN')

    const key = signingKey()
    const reviewId = randomUUID()
    const reviewItems = result.items.map(() => randomUUID())
    const expiresAt = Date.now() + FLAT_LAY_REVIEW_LIFETIME_MS
    return {
      expiresAt: new Date(expiresAt).toISOString(),
      items: result.items.map(({ bytes, category }, index) => {
        const itemId = reviewItems[index]!
        return {
          id: itemId,
          mask: bytes.toString('base64'),
          category,
          token: issueToken(key, userId, {
            reviewId,
            reviewItems,
            itemId,
            expiresAt,
            sha256: digest(bytes),
          }),
        }
      }),
    }
  }

  async confirm(
    auth: RequestAuthContext,
    input: FlatLaySelection
  ): Promise<FlatLayConfirmation> {
    const key = signingKey()
    const seen = new Set<string>()
    const now = Date.now()
    const verified = input.items.map(({ id, mask, token, tags }) => {
      const grant = verifyToken(key, auth.userId, token)
      const bytes = Buffer.from(mask, 'base64')
      if (
        grant.itemId !== id ||
        !grant.reviewItems.includes(id) ||
        grant.expiresAt <= now ||
        seen.has(id) ||
        bytes.length === 0 ||
        bytes.length > FLAT_LAY_MAX_MASK_BYTES ||
        mask !== bytes.toString('base64') ||
        grant.sha256 !== digest(bytes)
      )
        invalid()
      seen.add(id)
      return {
        id,
        grant,
        bytes,
        tags: {
          category: tags.category,
          subtype: tags.subtype ?? null,
          material: tags.material ?? null,
          comfortRange: tags.comfortRange ?? null,
        },
      }
    })

    const review = verified[0]?.grant
    if (!review || verified.some(({ grant }) => grant.reviewId !== review.reviewId))
      invalid()
    const pieces = await Promise.all(
      verified.map(async ({ grant, ...piece }) => ({
        ...piece,
        sha256: grant.sha256,
        ...(await maskDimensions(piece.bytes)),
      }))
    )
    return this.wardrobe.commitFlatLay(auth.userId, auth.role, {
      reviewId: review.reviewId,
      reviewItems: review.reviewItems,
      expiresAt: new Date(review.expiresAt),
      pieces,
    })
  }
}
