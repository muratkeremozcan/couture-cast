// Teen-path review finding B-8 (2026-11-15): the dead-letter routes answered anyone.
import { Module, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AccessTokenIdentityService } from '../modules/auth/access-token-identity.service'
import { GuardianConsentStateService } from '../modules/auth/guardian-consent-state.service'
import { listenHttpApp } from '../testing/loopback-http-app'

const ROLES: Record<string, string> = {
  'admin-token': 'admin',
  'adult-token': 'adult',
  'guardian-token': 'guardian',
  'teen-token': 'teen',
}

// The real guards; identity and consent are local seams.
@Module({
  providers: [
    {
      provide: AccessTokenIdentityService,
      useValue: {
        resolveIdentity: (token: string) =>
          ROLES[token]
            ? Promise.resolve({ userId: `user-${token}`, role: ROLES[token] })
            : Promise.reject(new Error('unknown token')),
      },
    },
    {
      provide: GuardianConsentStateService,
      useValue: { canTeenAccess: () => Promise.resolve(true) },
    },
  ],
  exports: [AccessTokenIdentityService, GuardianConsentStateService],
})
class LocalAuthModule {}

describe('A-FAILED-JOBS-AUTH: admin dead-letter routes', () => {
  let app: INestApplication | undefined
  let baseUrl = ''
  const adminService = {
    listFailedJobs: vi.fn().mockResolvedValue([]),
    retryFailedJob: vi.fn().mockResolvedValue({ status: 'requeued' }),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LocalAuthModule],
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: adminService }],
    }).compile()
    app = moduleRef.createNestApplication()
    baseUrl = await listenHttpApp(app)
  })

  afterAll(async () => {
    await app?.close()
  })

  const get = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })

  const routes = [
    '/api/v1/admin/failed-jobs',
    '/api/v1/admin/failed-jobs/retry?id=failure-1',
  ]

  it.each(routes)('%s answers 401 without a bearer and touches nothing', async (path) => {
    expect((await get(path)).status).toBe(401)
    expect(adminService.listFailedJobs).not.toHaveBeenCalled()
    expect(adminService.retryFailedJob).not.toHaveBeenCalled()
  })

  it.each(
    routes.flatMap((path) =>
      ['adult-token', 'guardian-token', 'teen-token'].map((token) => [path, token])
    )
  )('%s answers 403 for %s and touches nothing', async (path, token) => {
    expect((await get(path, token)).status).toBe(403)
    expect(adminService.listFailedJobs).not.toHaveBeenCalled()
    expect(adminService.retryFailedJob).not.toHaveBeenCalled()
  })

  it('an admin lists and retries', async () => {
    expect((await get(routes[0]!, 'admin-token')).status).toBe(200)
    expect(adminService.listFailedJobs).toHaveBeenCalledTimes(1)
    expect((await get(routes[1]!, 'admin-token')).status).toBe(200)
    expect(adminService.retryFailedJob).toHaveBeenCalledWith('failure-1')
  })
})
