// Story 6.5 owner: installation transfers serialize both owners and fence stale cleanup.
import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { PrismaClient, Prisma, type PushToken } from '@prisma/client'
import type { RegisterPushTokenInput } from '@couture/api-client/contracts/http'

class BindingChanged extends Error {}
export function projectRegistration(row: PushToken) {
  return {
    registrationId: row.id,
    bindingGeneration: row.binding_generation,
    platform: row.platform,
    permission: row.permission,
    lastUsedAt: row.last_used_at.toISOString(),
  }
}

function bindingMatches(row: PushToken, input: RegisterPushTokenInput) {
  return (
    input.expectedBinding?.registrationId === row.id &&
    input.expectedBinding.bindingGeneration === row.binding_generation
  )
}
function bindingChanges(row: PushToken, owner: string, input: RegisterPushTokenInput) {
  return (
    row.user_id !== owner ||
    row.token !== input.token ||
    row.installation_id !== input.installationId ||
    row.permission !== input.permission ||
    row.platform !== input.platform
  )
}
function assertExpectedBinding(
  row: PushToken | undefined,
  owner: string,
  input: RegisterPushTokenInput
) {
  const staleExpected = input.expectedBinding && (!row || !bindingMatches(row, input))
  const changedWithoutExpectation =
    row && bindingChanges(row, owner, input) && !bindingMatches(row, input)
  const implicitTransfer = row && row.user_id !== owner && input.transfer !== true
  if (staleExpected || changedWithoutExpectation || implicitTransfer)
    throw new ConflictException({
      code: 'binding_changed',
      message: 'Installation binding changed.',
    })
}

@Injectable()
export class PushRegistrationService {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async register(owner: string, input: RegisterPushTokenInput) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const discovered = await this.prisma.pushToken.findMany({
        where: {
          OR: [{ token: input.token }, { installation_id: input.installationId }],
        },
        orderBy: { id: 'asc' },
      })
      const members = [...new Set([owner, ...discovered.map((r) => r.user_id)])]
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw(
              Prisma.sql`SELECT community_privacy_guards(ARRAY[${Prisma.join(members)}]::text[],ARRAY[]::text[],true)`
            )
            const keys = await tx.$queryRaw<{ key: number }[]>(
              Prisma.sql`SELECT DISTINCT hashtext('community_member:' || member) AS key FROM unnest(ARRAY[${Prisma.join(members)}]::text[]) member ORDER BY key`
            )
            for (const { key } of keys)
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key}::bigint)`
            // New account state is checked after guards, before any binding is written.
            if (!(await tx.communitySubject.findUnique({ where: { member_id: owner } })))
              throw new ConflictException('Account unavailable.')
            const locked = await tx.$queryRaw<PushToken[]>`
            SELECT * FROM "PushToken" WHERE token = ${input.token} OR installation_id = ${input.installationId} ORDER BY id FOR UPDATE
          `
            if (
              JSON.stringify(
                locked.map((r) => [r.id, r.user_id, r.binding_generation])
              ) !==
              JSON.stringify(
                discovered.map((r) => [r.id, r.user_id, r.binding_generation])
              )
            )
              throw new BindingChanged()
            const existing =
              locked.find((r) => r.installation_id === input.installationId) ??
              locked.find((r) => r.token === input.token)
            const extra = locked.filter((r) => r.id !== existing?.id)
            const count = await tx.pushToken.count({
              where: {
                user_id: owner,
                id: { notIn: locked.map((r) => r.id) },
                last_used_at: { gt: new Date(Date.now() - 30 * 86_400_000) },
              },
            })
            if (count >= 5)
              throw new ConflictException({
                code: 'registration_limit',
                message: 'Five active installations are allowed.',
              })
            assertExpectedBinding(existing, owner, input)
            const changed = existing ? bindingChanges(existing, owner, input) : false
            for (const row of locked) {
              if (changed || row.id !== existing?.id) await this.cancel(tx, row)
            }
            for (const row of extra) await tx.pushToken.delete({ where: { id: row.id } })
            const data = {
              user_id: owner,
              token: input.token,
              installation_id: input.installationId,
              platform: input.platform,
              permission: input.permission,
              last_used_at: new Date(),
            }
            const row = existing
              ? await tx.pushToken.update({
                  where: { id: existing.id },
                  data: {
                    ...data,
                    ...(changed ? { binding_generation: { increment: 1 } } : {}),
                  },
                })
              : await tx.pushToken.create({ data })
            return projectRegistration(row)
          },
          { isolationLevel: 'ReadCommitted', timeout: 5000 }
        )
      } catch (error) {
        if (
          error instanceof BindingChanged ||
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002')
        )
          continue
        throw error
      }
    }
    throw new ConflictException({
      code: 'binding_changed',
      message: 'Installation binding changed. Retry registration.',
    })
  }

  private async cancel(tx: Prisma.TransactionClient, row: PushToken) {
    await tx.communityTokenDelivery.updateMany({
      where: {
        registration_id: row.id,
        owner_id: row.user_id,
        binding_generation: row.binding_generation,
        status: { in: ['pending', 'deferred', 'retryable_rejection'] },
      },
      data: { status: 'suppressed' },
    })
  }

  async list(owner: string) {
    const rows = await this.prisma.pushToken.findMany({
      where: {
        user_id: owner,
        last_used_at: { gt: new Date(Date.now() - 30 * 86_400_000) },
      },
      orderBy: { id: 'asc' },
      take: 5,
    })
    return { registrations: rows.map(projectRegistration) }
  }

  async remove(owner: string, id: string, generation: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT community_privacy_guards(ARRAY[${owner}]::text[],ARRAY[]::text[],true)`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('community_member:' || ${owner}))`
      const row = await tx.pushToken.findFirst({
        where: { id, user_id: owner, binding_generation: generation },
      })
      if (!row) return { removed: false }
      await this.cancel(tx, row)
      return {
        removed:
          (
            await tx.pushToken.deleteMany({
              where: { id, user_id: owner, binding_generation: generation },
            })
          ).count === 1,
      }
    })
  }
}
