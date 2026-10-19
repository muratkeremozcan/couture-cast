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
