import {
  UnauthorizedException,
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common'
import type { ApiRole, AuthenticatedRequest, RequestAuthContext } from './security.types'

export const API_ROLES_KEY = 'api_roles'
export const API_TRANSACTIONAL_CONSENT_KEY = 'api_transactional_consent'
/** The marked handler checks authoritative consent under its transaction lock. */
export const ConsentCheckedInTransaction = () =>
  SetMetadata(API_TRANSACTIONAL_CONSENT_KEY, true)

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
