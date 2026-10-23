/**
 * Reset state owned by the synthetic member before each flow and watchdog retry.
 * A timed-out flow can have saved a reaction before stalling during relaunch.
 */
export const resetMobileE2EFlowState = async (prisma, userId) => {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Mobile E2E flow reset requires a member ID')
  }
  await prisma.$transaction([
    prisma.wardrobeOnboardingState.deleteMany({ where: { user_id: userId } }),
    prisma.communityReactionOutbox.deleteMany({ where: { user_id: userId } }),
    prisma.communityReactionReceipt.deleteMany({ where: { user_id: userId } }),
    prisma.communityReaction.deleteMany({ where: { user_id: userId } }),
  ])
}

/**
 * The saved location `setupMobileE2EIdentity` gives every synthetic member,
 * which every other flow's ritual and community band read.
 */
export const MOBILE_E2E_BASELINE_LOCATION = {
  label: 'Chicago',
  location_key: 'chicago-il',
  latitude: 41.878,
  longitude: -87.63,
  timezone: 'America/Chicago',
  city: 'Chicago',
  region: 'Illinois',
  country: 'United States',
}

const requireMember = (userId) => {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Mobile E2E location state requires a member ID')
  }
}

/**
 * Story 1.2b: the location capture flow starts from a member with no saved
 * location and no snapshot for the sentinel place the run searches for.
 */
export const clearMobileE2ELocations = async (prisma, userId, sentinelKeySuffix) => {
  requireMember(userId)
  if (typeof sentinelKeySuffix !== 'string' || sentinelKeySuffix.length === 0) {
    throw new Error('Mobile E2E location reset requires the sentinel key suffix')
  }
  const snapshots = { location_key: { endsWith: sentinelKeySuffix } }
  await prisma.$transaction([
    prisma.savedLocation.deleteMany({ where: { user_id: userId } }),
    prisma.forecastSegment.deleteMany({ where: { weather_snapshot: snapshots } }),
    prisma.weatherSnapshot.deleteMany({ where: snapshots }),
  ])
}

/**
 * Puts the member back on the baseline location alone, as primary, so the
 * flows that run after the location capture flow read what they always read.
 */
export const restoreMobileE2EBaselineLocation = async (prisma, userId) => {
  requireMember(userId)
  await prisma.$transaction([
    prisma.savedLocation.deleteMany({ where: { user_id: userId } }),
    prisma.savedLocation.create({
      data: {
        ...MOBILE_E2E_BASELINE_LOCATION,
        user_id: userId,
        is_primary: true,
        sort_order: 0,
      },
    }),
  ])
}
