import { Inject, Injectable, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import type { ScenarioOutfit } from '../../contracts/http.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import type { RequestAuthContext } from '../auth/security.types.js'
import {
  SupabaseWardrobeStorageAdapter,
  type WardrobeStorage,
} from '../wardrobe/wardrobe-storage.adapter.js'
import { isOwnGarmentObject } from '../wardrobe/wardrobe-upload-paths.js'

type DisplayGarment = NonNullable<ScenarioOutfit['displayGarments']>[number]

const READ_URL_EXPIRY_SECONDS = 900

@Injectable()
export class RitualGarmentPhotoService {
  private readonly logger = new Logger(RitualGarmentPhotoService.name)

  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Inject(SupabaseWardrobeStorageAdapter) private readonly storage: WardrobeStorage,
    @Inject(GuardianConsentStateService)
    private readonly guardianConsent: GuardianConsentStateService
  ) {}

  async resolve(
    actor: RequestAuthContext,
    outfits: readonly Pick<ScenarioOutfit, 'garmentIds'>[]
  ): Promise<Map<string, DisplayGarment> | null> {
    const ids = [
      ...new Set(
        outfits.flatMap(({ garmentIds }) =>
          garmentIds.filter((id) => !id.startsWith('default-'))
        )
      ),
    ]
    const result = new Map<string, DisplayGarment>()
    try {
      if (
        actor.role === 'teen' &&
        !(await this.guardianConsent.canTeenViewPrivateGarmentPhotos(actor.userId))
      ) {
        return null
      }
    } catch {
      this.logger.warn('Could not verify access to ritual garment photos')
      return null
    }

    if (ids.length === 0) return result

    try {
      const garments = await this.prisma.garmentItem.findMany({
        where: {
          id: { in: ids },
          user_id: actor.userId,
          upload_status: 'ready',
          retention_status: 'active',
          deletion_requested_at: null,
        },
        select: { id: true, user_id: true, category: true, object_path: true },
      })
      await Promise.all(
        garments.map(async (garment) => {
          const display: DisplayGarment = {
            id: garment.id,
            category: garment.category,
          }
          result.set(garment.id, display)
          if (!isOwnGarmentObject(garment)) return
          try {
            const expiresAt = new Date(
              Date.now() + READ_URL_EXPIRY_SECONDS * 1000
            ).toISOString()
            const url = await this.storage.signReadUrl(
              garment.object_path,
              READ_URL_EXPIRY_SECONDS
            )
            display.imageAccess = { url, expiresAt }
          } catch {
            this.logger.warn('Could not sign a ritual garment photo')
          }
        })
      )
    } catch {
      this.logger.warn('Could not load ritual garment photos')
    }

    return result
  }
}
