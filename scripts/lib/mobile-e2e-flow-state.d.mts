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

export declare function mobileE2EBaselineLocationRequestBody(): {
  label: string
  locationKey: string
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

export declare function locationCaptureWeatherDoubleCause(observed: {
  before: { geocoding: number; forecast: number }
  requests: {
    geocoding: { seq: number; query: string }[]
    forecast: { seq: number; latitude: number | null; longitude: number | null }[]
  }
  query: string
  place: { lat: number; lon: number }
}): string | undefined
