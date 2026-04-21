import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Prisma, PrismaClient } from '@prisma/client'
import { updateRequestContext } from '../../logger/request-context'
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

function extractComplianceState(
  preferences: Prisma.JsonValue | null | undefined
): Record<string, unknown> {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return {}
  }

  const compliance = (preferences as Record<string, unknown>).compliance
  if (!compliance || typeof compliance !== 'object' || Array.isArray(compliance)) {
    return {}
  }

  return compliance as Record<string, unknown>
}

function requiresGuardianConsent(preferences: Prisma.JsonValue | null | undefined) {
  const compliance = extractComplianceState(preferences)
  return (
    compliance.accountStatus === 'pending_guardian_consent' &&
    (compliance.guardianConsentRequired === true ||
      compliance.guardianConsentRequired === 'true')
  )
}

@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = parseBearerToken(request.headers.authorization)
    const userId = normalizeHeaderValue(request.headers[USER_ID_HEADER])
    const role = parseRole(request.headers[USER_ROLE_HEADER])

    if (!token || !userId || !role) {
      throw new UnauthorizedException('Missing or invalid authentication headers')
    }

    request.auth = { token, userId, role }
    updateRequestContext({ userId })

    if (role === 'teen') {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          profile: {
            select: {
              preferences: true,
            },
          },
        },
      })

      if (requiresGuardianConsent(user?.profile?.preferences)) {
        throw new ForbiddenException('Guardian consent required before continuing')
      }
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
