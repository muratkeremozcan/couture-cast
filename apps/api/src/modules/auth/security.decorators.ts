import {
  UnauthorizedException,
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common'
import type { ApiRole, AuthenticatedRequest, RequestAuthContext } from './security.types'

export const API_ROLES_KEY = 'api_roles'
export const API_TRANSACTIONAL_CONSENT_KEY = 'api_transactional_consent'
export const API_ALLOW_PENDING_GUARDIAN_TEEN_KEY = 'api_allow_pending_guardian_teen'
/** The marked handler checks authoritative consent under its transaction lock. */
export const ConsentCheckedInTransaction = () =>
  SetMetadata(API_TRANSACTIONAL_CONSENT_KEY, true)
/**
 * Story CC-7.2 (Epic 7 guardrail): guardian-pending teens can use non-upload,
 * non-posting member surfaces (Today, Looks, Shuffle, Swap, Save) with the same
 * tap counts as approved members while suspended accounts remain blocked.
 */
export const AllowPendingGuardianTeen = () =>
  SetMetadata(API_ALLOW_PENDING_GUARDIAN_TEEN_KEY, true)

export const Roles = (...roles: ApiRole[]) => SetMetadata(API_ROLES_KEY, roles)

export const AuthContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestAuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (!request.auth) {
      throw new UnauthorizedException('Missing authenticated user context')
    }

    return request.auth
  }
)
