import {
  UnauthorizedException,
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common'
import type { ApiRole, AuthenticatedRequest, RequestAuthContext } from './security.types'

export const API_ROLES_KEY = 'api_roles'

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
