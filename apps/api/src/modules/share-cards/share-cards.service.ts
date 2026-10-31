// Story 6.8 Task 2 step 1 owner: orchestrate deadline, admission, rechecks and audit in `apps/api/src/modules/share-cards/share-cards.service.ts`
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import {
  prepareShareCardResponseSchema,
  type PrepareShareCardInput,
  type PreparedShareCard,
  type ShareCardCapabilities,
} from '@couture/api-client/contracts/http'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js'
import { SupabaseCommunityStorageAdapter } from '../community/community-storage.adapter.js'
import { verifyAndNormalizeCommunityImage } from '../community/community-image-validation.js'
import { ShareCardSourceRepository } from './share-card-source.repository.js'
import { ShareCardRenderer } from './share-card-renderer.js'
import { ShareCardAdmission } from './share-card-admission.js'
import { interactiveTransaction } from '../../prisma/prisma-client.js'

export const SHARE_CARD_GLOBAL_LIMIT = 4
export const SHARE_CARD_MEMBER_LIMIT = 1
const unavailable = () =>
  new ServiceUnavailableException({
    statusCode: 503,
    code: 'render_unavailable',
    message: 'render_unavailable',
  })
const admission = new ShareCardAdmission(SHARE_CARD_GLOBAL_LIMIT, unavailable)
// Story 6.9 D4: a share prepare with the flag off is refused before any source,
// storage or render work, and before the audit row.
const shareDisabled = () =>
  new ForbiddenException({
    statusCode: 403,
    code: 'share_disabled',
    message: 'share_disabled',
  })
const previewChanged = () =>
  new ConflictException({
    statusCode: 409,
    code: 'preview_changed',
    message: 'preview_changed',
  })

@Injectable()
export class ShareCardsService {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(ShareCardSourceRepository)
    private readonly sources: ShareCardSourceRepository,
    @Inject(ShareCardRenderer) private readonly renderer: ShareCardRenderer,
    @Inject(SupabaseCommunityStorageAdapter)
    private readonly storage: SupabaseCommunityStorageAdapter,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService
  ) {}
  /** Story 6.9 D4: the caller's own flag answer; a failed read is off. */
  async capabilities(member: string): Promise<ShareCardCapabilities> {
    return { nativeShare: await this.nativeShareEnabled(member) }
  }
  private async nativeShareEnabled(member: string): Promise<boolean> {
    try {
      // PostHog first, then the Postgres fallback row, then the code default (false).
      // The registry types the value as its `false` default; only a real `true` opens.
      const value: unknown = await this.flags.getFeatureFlag(
        'share_card_native_share_enabled',
        member
      )
      return value === true
    } catch {
      return false
    }
  }
  async prepare(
    member: string,
    input: PrepareShareCardInput,
    parent?: AbortSignal
  ): Promise<PreparedShareCard> {
    const controller = new AbortController()
    const check = () => {
      if (controller.signal.aborted) throw unavailable()
    }
    let refuse: () => void = () => undefined
    const cancelled = new Promise<never>((_, reject) => {
      refuse = () => reject(unavailable())
    })
    const abort = () => {
      controller.abort()
      refuse()
    }
    parent?.addEventListener('abort', abort, { once: true })
    if (parent?.aborted) abort()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort()
        reject(unavailable())
      }, 15000)
    })
    const operation = async () => {
      check()
      const source = await this.sources.resolve(member, input.source)
      check()
      let photo: Buffer | undefined
      if (source.kind === 'community_post') {
        const bytes = await this.storage.downloadBounded(
          source.path,
          10 * 1024 * 1024,
          controller.signal
        )
        check()
        photo = (
          await verifyAndNormalizeCommunityImage(bytes, source, 5, controller.signal)
        ).bytes
      }
      check()
      const { bytes, accessibilityLabel } = await this.renderer.prepare(
        source,
        input.locale,
        input.watermark,
        photo,
        controller.signal
      )
      check()
      const final = await this.sources.resolve(member, input.source)
      check()
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      // Save and share both authorize exactly the bytes the member previewed.
      if (
        JSON.stringify(source) !== JSON.stringify(final) ||
        (input.purpose !== 'preview' && input.expectedSha256 !== sha256)
      )
        throw previewChanged()
      const result = prepareShareCardResponseSchema.parse({
        data: {
          pngBase64: bytes.toString('base64'),
          accessibilityLabel,
          sha256,
          width: 1080,
          height: 1350,
          mimeType: 'image/png',
          filename: 'couturecast-card.png',
          templateVersion: 1,
        },
      }).data
      if (input.purpose !== 'preview') {
        await interactiveTransaction(
          this.prisma,
          async (tx) => {
            check()
            await tx.auditLog.create({
              data: {
                user_id: member,
                event_type: 'share_card_export_authorized',
                event_data: {
                  sourceKind: source.kind,
                  locale: input.locale,
                  watermark: input.watermark,
                  templateVersion: 1,
                  purpose: input.purpose,
                },
              },
            })
            check()
            const granted = await this.sources.resolveGuarded(member, input.source, tx)
            check()
            if (JSON.stringify(granted) !== JSON.stringify(source)) throw previewChanged()
          },
          { timeout: 5000, maxWait: 1000 }
        )
        check()
      }
      return result
    }
    // A timed-out/disconnected caller cannot free capacity while native/DB work is still active.
    const owned = (async () => {
      if (input.purpose === 'share' && !(await this.nativeShareEnabled(member)))
        throw shareDisabled()
      check()
      const release = await admission.acquire(member, controller.signal)
      try {
        return await operation()
      } finally {
        release()
      }
    })()
    try {
      return await Promise.race([owned, deadline, cancelled])
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw unavailable()
    } finally {
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
    }
  }
}
