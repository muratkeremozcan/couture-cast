import type { PrismaClient } from '@prisma/client'

export declare function resetMobileE2EFlowState(
  prisma: PrismaClient,
  userId: string
): Promise<void>

export declare const MOBILE_E2E_BASELINE_LOCATION: {
  label: string
  location_key: string
  latitude: number
  longitude: number
  timezone: string
  city: string
  region: string
  country: string
}

export declare function clearMobileE2ELocations(
  prisma: PrismaClient,
  userId: string,
  sentinelKeySuffix: string
): Promise<void>

export declare function restoreMobileE2EBaselineLocation(
  prisma: PrismaClient,
  userId: string
): Promise<void>
