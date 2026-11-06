// Story 6.13 owner: an erased account uses no moderation route, whatever role its token still carries.
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { moderationDecisionError } from './moderation-decision-rules.js'

/**
 * Runs after `RolesGuard`, and answers exactly as a sanctioned operator is answered.
 * It covers reads, whose audit rows name the operator. A write still repeats the check inside its
 * transaction, under the sanction lock, because this read cannot see an erasure that commits next.
 */
@Injectable()
export class ModerationOperatorGuard implements CanActivate {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { auth } = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (!auth) return true
    const request = await this.prisma.moderationErasureRequest.findUnique({
      where: { member_id: auth.userId },
      select: { id: true },
    })
    if (request) throw moderationDecisionError('operator_sanctioned')
    return true
  }
}
