import type { Prisma, PrismaClient } from '@prisma/client'

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

export declare const LOCATION_CAPTURE_FLOW: 'maestro/location-capture.yaml'

export declare const COMMUNITY_COMMENTS_FLOW: 'maestro/community-comments.yaml'

export declare const COMMUNITY_COMMENTS_LONG_ROOT: string

export type CommunityCommentsLongRootTarget = { postId: string; authorId: string }

export declare const COMMUNITY_COMMENTS_LONG_ROOT_TARGET: Readonly<CommunityCommentsLongRootTarget>

export type CommunityCommentFixtureCleanup = (
  tx: Prisma.TransactionClient,
  commentIds: string[]
) => Promise<void>

export declare function seedCommunityCommentsLongRoot(
  prisma: PrismaClient,
  cleanupComments: CommunityCommentFixtureCleanup,
  target?: CommunityCommentsLongRootTarget
): Promise<void>

export declare function removeCommunityCommentsLongRoot(
  prisma: PrismaClient,
  cleanupComments: CommunityCommentFixtureCleanup,
  target?: CommunityCommentsLongRootTarget
): Promise<void>

export type MobileE2EFlowStateHook = {
  before: (prisma: PrismaClient, userId: string) => Promise<void>
  after: (prisma: PrismaClient, userId: string) => Promise<void>
}

export declare function mobileE2EFlowStateHooks(options: {
  locationSentinelKeySuffix: string
  cleanupComments: CommunityCommentFixtureCleanup
  longRootTarget?: CommunityCommentsLongRootTarget
}): Record<string, MobileE2EFlowStateHook>
