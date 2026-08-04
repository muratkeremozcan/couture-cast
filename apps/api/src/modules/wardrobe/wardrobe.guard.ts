// Story 4.1 Task 5 step 3 owner: implement WardrobeUploadGuard after auth guard
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import type { RequestAuthContext } from '../auth/security.types'
import { GuardianService } from '../guardian/guardian.service'

@Injectable()
export class WardrobeUploadGuard implements CanActivate {
  constructor(
    @Inject(GuardianService) private readonly guardianService: GuardianService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ auth?: RequestAuthContext }>()
    const auth = request.auth
    if (!auth || !auth.userId) {
      return false
    }

    await this.guardianService.assertWardrobeUploadAllowed(auth.userId, auth.role)
    return true
  }
}
