// Learning path Step 41: Curated reactions.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-41-curated-reactions
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { runMobileE2EFlow } from '../../../scripts/lib/mobile-e2e-flow-retry.mjs'
import { resetMobileE2EFlowState } from '../../../scripts/lib/mobile-e2e-flow-state.mjs'

import { reactionTestContext } from './helpers/community-reaction-context.js'

const { prisma, repository, input, fixture, mutate } = reactionTestContext()

describe('Story 6.3 mobile flow fixture reset', () => {
  it('resets a retried mobile flow and preserves state for another member', async () => {
    const member = await fixture()
    const other = await fixture()
    // Cross-owned posts prove reset scopes by the reacting member's identity.
    await mutate(member.userId, other.postId, input('love'))
    await mutate(other.userId, member.postId, input('love'))
    await prisma.wardrobeOnboardingState.createMany({
      data: [{ user_id: member.userId }, { user_id: other.userId }],
    })
    const readMemberState = (userId: string) =>
      Promise.all([
        prisma.communityReaction.findMany({ where: { user_id: userId } }),
        prisma.communityReactionReceipt.findMany({ where: { user_id: userId } }),
        prisma.communityReactionOutbox.findMany({ where: { user_id: userId } }),
        prisma.wardrobeOnboardingState.findMany({ where: { user_id: userId } }),
      ])
    const sentinel = await readMemberState(other.userId)
    expect(sentinel.map((rows) => rows.length)).toEqual([1, 1, 1, 1])
    const memberBefore = await readMemberState(member.userId)
    for (const invalidId of [undefined, '', '   ']) {
      await expect(
        Reflect.apply(resetMobileE2EFlowState, undefined, [prisma, invalidId])
      ).rejects.toThrow('requires a member ID')
      expect(await readMemberState(member.userId)).toEqual(memberBefore)
      expect(await readMemberState(other.userId)).toEqual(sentinel)
    }
    const before = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: other.postId },
    })

    await resetMobileE2EFlowState(prisma, member.userId)

    expect(await readMemberState(member.userId)).toEqual([[], [], [], []])
    expect(await readMemberState(other.userId)).toEqual(sentinel)
    const after = await prisma.lookbookPost.findUniqueOrThrow({
      where: { id: other.postId },
    })
    expect(after.reaction_generation).toBeGreaterThan(before.reaction_generation)
    expect(
      (await repository.reactionSummaries([other.postId], member.userId)).get(
        other.postId
      )
    ).toMatchObject({
      counts: { applause: 0, love: 0, inspiration: 0 },
      total: 0,
      revision: 0,
      viewerReaction: null,
    })

    await resetMobileE2EFlowState(prisma, member.userId)

    expect(await readMemberState(member.userId)).toEqual([[], [], [], []])
    expect(await readMemberState(other.userId)).toEqual(sentinel)
    expect(
      await prisma.lookbookPost.findUniqueOrThrow({ where: { id: other.postId } })
    ).toEqual(after)
    expect(await mutate(member.userId, other.postId, input('applause'))).toMatchObject({
      summary: {
        counts: { applause: 1, love: 0, inspiration: 0 },
        total: 1,
        viewerReaction: 'applause',
        revision: 1,
      },
    })
    expect(await readMemberState(other.userId)).toEqual(sentinel)
  })
  it('turns a member back to the default affiliate suggestions that a stalled flow switched off, and leaves other members alone', async () => {
    const member = await fixture()
    const other = await fixture()
    await prisma.commercePreference.createMany({
      data: [
        { user_id: member.userId, affiliate_ctas_enabled: false },
        { user_id: other.userId, affiliate_ctas_enabled: false },
      ],
    })

    await resetMobileE2EFlowState(prisma, member.userId)

    expect(
      await prisma.commercePreference.findUnique({ where: { user_id: member.userId } })
    ).toBeNull()
    expect(
      await prisma.commercePreference.findUniqueOrThrow({
        where: { user_id: other.userId },
      })
    ).toMatchObject({ affiliate_ctas_enabled: false })
  })
  it('rolls back every deletion and generation when a later deletion fails', async () => {
    const member = await fixture()
    await mutate(member.userId, member.postId, input('love'))
    await prisma.wardrobeOnboardingState.create({ data: { user_id: member.userId } })
    const snapshot = () =>
      Promise.all([
        prisma.wardrobeOnboardingState.findMany({ where: { user_id: member.userId } }),
        prisma.communityReactionOutbox.findMany({ where: { user_id: member.userId } }),
        prisma.communityReactionReceipt.findMany({ where: { user_id: member.userId } }),
        prisma.communityReaction.findMany({ where: { user_id: member.userId } }),
        prisma.lookbookPost.findUniqueOrThrow({ where: { id: member.postId } }),
      ])
    const before = await snapshot()
    // This trigger belongs only to this suite's disposable database. The final
    // delete fails after the first three statements and the generation trigger.
    // PostgreSQL runs same-event triggers by name, so zz_ follows generation.
    await prisma.$executeRaw`CREATE FUNCTION fail_mobile_flow_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'injected mobile flow delete failure after generation %',
        (SELECT reaction_generation FROM "LookbookPost" WHERE id = OLD.post_id); END;
    $$ LANGUAGE plpgsql`
    try {
      await prisma.$executeRaw`CREATE TRIGGER zz_fail_mobile_flow_delete
        AFTER DELETE ON "CommunityReaction"
        FOR EACH ROW EXECUTE FUNCTION fail_mobile_flow_delete()`
      await expect(resetMobileE2EFlowState(prisma, member.userId)).rejects.toThrow(
        `injected mobile flow delete failure after generation ${before[4].reaction_generation + 1}`
      )
      expect(await snapshot()).toEqual(before)
    } finally {
      await prisma.$executeRaw`DROP TRIGGER IF EXISTS zz_fail_mobile_flow_delete ON "CommunityReaction"`
      await prisma.$executeRaw`DROP FUNCTION fail_mobile_flow_delete()`
    }
    await resetMobileE2EFlowState(prisma, member.userId)
    const after = await snapshot()
    expect(after.slice(0, 4)).toEqual([[], [], [], []])
    expect(after[4]).toMatchObject({ reaction_generation: expect.any(Number) as unknown })
    expect(after[4].reaction_generation).toBeGreaterThan(before[4].reaction_generation)
  })

  it('restores committed state before the watchdog reruns the actual flow orchestration', async () => {
    const member = await fixture()
    const order: string[] = []
    const timeout = Object.assign(new Error('relaunch stalled after saving'), {
      timedOut: true,
    })
    let attempt = 0
    await runMobileE2EFlow({
      reset: async () => {
        order.push('reset')
        await resetMobileE2EFlowState(prisma, member.userId)
      },
      onRetry: () => {
        order.push('retry')
      },
      run: async () => {
        order.push('run')
        const summary = (
          await repository.reactionSummaries([member.postId], member.userId)
        ).get(member.postId)
        expect(summary).toMatchObject({ total: 0, revision: 0, viewerReaction: null })
        const result = await mutate(member.userId, member.postId, input('love'))
        expect(result).toMatchObject({ summary: { total: 1, revision: 1 } })
        if (attempt++ === 0) throw timeout
      },
    })
    expect(order).toEqual(['reset', 'run', 'retry', 'reset', 'run'])
    expect(
      await prisma.communityReactionReceipt.count({ where: { user_id: member.userId } })
    ).toBe(1)
    expect(
      await prisma.communityReactionOutbox.count({ where: { user_id: member.userId } })
    ).toBe(1)
  })
})
