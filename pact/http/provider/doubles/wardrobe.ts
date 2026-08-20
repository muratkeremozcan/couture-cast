import type { ApiRole } from '../../../../apps/api/src/modules/auth/security.types'
import type { WardrobeRetentionService } from '../../../../apps/api/src/modules/wardrobe/wardrobe-retention.service'
import type { WardrobeService } from '../../../../apps/api/src/modules/wardrobe/wardrobe.service'
import { GARMENT_TAGGING_ANALYSIS_VERSION } from '@couture/api-client'
import type {
  GarmentCategory,
  GarmentComfortRange,
  GarmentMaterial,
} from '@couture/api-client'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { getProviderWardrobeState } from '../state'

/**
 * Provider doubles for the wardrobe surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createWardrobeDoubles() {
  const assertProviderWardrobeState = (userId: string, garmentId: string) => {
    if (
      getProviderWardrobeState().outcome === 'not_found' ||
      getProviderWardrobeState().garmentId !== garmentId ||
      getProviderWardrobeState().userId !== userId
    ) {
      throw new NotFoundException('GARMENT_NOT_FOUND')
    }
    if (!getProviderWardrobeState().guardianAllowed) {
      throw new ForbiddenException('GUARDIAN_CONSENT_REQUIRED')
    }
    if (getProviderWardrobeState().outcome === 'analysis_pending') {
      throw new ConflictException('GARMENT_ANALYSIS_PENDING')
    }
  }

  const mockWardrobeService = {
    suggestGarmentTags: (userId: string, _role: ApiRole, garmentId: string) => {
      assertProviderWardrobeState(userId, garmentId)
      if (getProviderWardrobeState().outcome === 'inference_unavailable') {
        throw new ServiceUnavailableException('TAGGING_INFERENCE_UNAVAILABLE')
      }
      return Promise.resolve({
        data: {
          garmentId,
          analysisVersion: GARMENT_TAGGING_ANALYSIS_VERSION,
          suggestions: {
            category: { value: 'top', confidence: 0.85, isConfident: true },
            material: { value: 'cotton', confidence: 0.72, isConfident: true },
            comfortRange: { value: 'mild', confidence: 0.72, isConfident: true },
          },
        },
      })
    },
    updateGarmentTags: (
      userId: string,
      _role: ApiRole,
      garmentId: string,
      input: {
        category: GarmentCategory
        material?: GarmentMaterial | null
        comfortRange: GarmentComfortRange
      }
    ) => {
      assertProviderWardrobeState(userId, garmentId)
      const categoryValue = input.category
      const materialValue = input.material ?? null
      const comfortValue = input.comfortRange
      return Promise.resolve({
        data: {
          id: garmentId,
          status: 'ready',
          category: categoryValue,
          material: materialValue,
          comfortRange: comfortValue,
          tagsConfirmedAt: '2026-08-05T12:00:00.000Z',
          fileSizeBytes: 1024,
          mimeType: 'image/png',
          retentionStatus: 'active',
          createdAt: '2026-08-05T10:00:00.000Z',
          committedAt: '2026-08-05T10:01:00.000Z',
          imageAccess: {
            url: 'https://example.com/read.png',
            expiresAt: '2026-08-05T12:15:00.000Z',
          },
        },
      })
    },
  } as unknown as WardrobeService

  const mockWardrobeRetentionService = {} as unknown as WardrobeRetentionService

  /**
   * Story 4.3 capsule provider double.
   *
   * The verifier sets a named scenario before each interaction and this returns
   * the matching deterministic representation, or throws the documented error.
   * An unconfigured scenario throws NotFound so a missing provider state fails
   * loudly instead of verifying against stale in-memory data.
   */

  return { mockWardrobeService, mockWardrobeRetentionService }
}
