import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { API_ROLES_KEY } from './security.decorators'
import { API_ROLES, type ApiRole, type AuthenticatedRequest } from './security.types'

const USER_ID_HEADER = 'x-user-id'
const USER_ROLE_HEADER = 'x-user-role'

const normalizeHeaderValue = (
  value: string | string[] | undefined
): string | undefined => {
  if (Array.isArray(value)) {
    return normalizeHeaderValue(value[0])
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

const parseBearerToken = (
  authorizationHeader: string | string[] | undefined
): string | undefined => {
  const headerValue = normalizeHeaderValue(authorizationHeader)
  if (!headerValue || !headerValue.startsWith('Bearer ')) {
    return undefined
  }

  const token = headerValue.slice('Bearer '.length).trim()
  return token.length > 0 ? token : undefined
}

const parseRole = (headerValue: string | string[] | undefined): ApiRole | undefined => {
  const value = normalizeHeaderValue(headerValue)?.toLowerCase()
  if (!value) {
    return undefined
  }

  return API_ROLES.find((role) => role === value)
}

@Injectable()
export class RequestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = parseBearerToken(request.headers.authorization)
    const userId = normalizeHeaderValue(request.headers[USER_ID_HEADER])
    const role = parseRole(request.headers[USER_ROLE_HEADER])

    if (!token || !userId || !role) {
      throw new UnauthorizedException('Missing or invalid authentication headers')
    }

    request.auth = { token, userId, role }
    return true
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly reflector = new Reflector()

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<ApiRole[]>(API_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []

    if (requiredRoles.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const role = request.auth?.role

    if (!role) {
      throw new UnauthorizedException('Missing authenticated user context')
    }

    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException('Insufficient role')
    }

    return true
  }
}
