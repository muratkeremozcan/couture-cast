import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { updateRequestContext } from '../../logger/request-context'
import { AccessTokenIdentityService } from './access-token-identity.service.js'
import { GuardianConsentStateService } from './guardian-consent-state.service'
import { API_ROLES_KEY } from './security.decorators'
import { type ApiRole, type AuthenticatedRequest } from './security.types'

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
  const match = headerValue ? /^Bearer\s+(.+)$/i.exec(headerValue) : null
  const token = match?.[1]?.trim()
  if (!token) {
    return undefined
  }

  return token
}

@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(
    @Inject(GuardianConsentStateService)
    private readonly guardianConsentStateService: GuardianConsentStateService,
    @Inject(AccessTokenIdentityService)
    private readonly accessTokenIdentityService: AccessTokenIdentityService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = parseBearerToken(request.headers.authorization)

    if (!token) {
      throw new UnauthorizedException('Missing or invalid bearer token')
    }

    let identity: { userId: string; role: ApiRole }
    try {
      identity = await this.accessTokenIdentityService.resolveIdentity(token, request)
    } catch {
      throw new UnauthorizedException('Invalid access token')
    }

    const { userId, role } = identity
    request.auth = { token, userId, role }
    updateRequestContext({ userId })

    if (
      role === 'teen' &&
      !(await this.guardianConsentStateService.canTeenAccess(userId))
    ) {
      throw new ForbiddenException('Guardian consent required before continuing')
    }

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
