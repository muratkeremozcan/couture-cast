import { Injectable } from '@nestjs/common'

@Injectable()
export class UserSessionService {
  invalidateUserSessions(userId: string): Promise<void> {
    void userId
    // Auth is currently header-driven in local/dev flows, so there is no backing
    // session store to revoke yet. Keep the contract explicit so revoke flows can
    // call a concrete invalidation boundary once real session storage exists.
    return Promise.resolve()
  }
}
