// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpTestUrl, listenHttpApp } from '../../testing/loopback-http-app.js'
import { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service.js'
import { StyleProfileController } from './style-profile.controller.js'

const PATH = '/api/v1/personalization/style-profile'
const OWNER = 'style-profile-test-member'
const EMPTY = { mood: null, palette: null, texture: null, fit: null, avoid: [] }

describe('StyleProfileController', () => {
  let app: INestApplication
  const findUnique = vi.fn()
  const upsert = vi.fn()
  const deleteMany = vi.fn()
  const canTeenAccess = vi.fn()
  const canTeenAccessNonUploadSurface = vi.fn()

  beforeEach(async () => {
    vi.resetAllMocks()
    canTeenAccess.mockResolvedValue(false)
    canTeenAccessNonUploadSurface.mockResolvedValue(true)
    const sut = await Test.createTestingModule({
      controllers: [StyleProfileController],
      providers: [
        {
          provide: PrismaClient,
          useValue: { styleProfile: { findUnique, upsert, deleteMany } },
        },
        {
          provide: AccessTokenIdentityService,
          useValue: {
            resolveIdentity: () => Promise.resolve({ userId: OWNER, role: 'teen' }),
          },
        },
        {
          provide: GuardianConsentStateService,
          useValue: { canTeenAccess, canTeenAccessNonUploadSurface },
        },
      ],
    }).compile()
    app = sut.createNestApplication()
    await listenHttpApp(app)
  })

  afterEach(async () => {
    await app?.close()
  })

  it('uses non-upload consent for the pending-teen style route and prevents cached answers', async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...EMPTY, mood: 'cozy' })
    const api = request(httpTestUrl(app))
    const headers = { authorization: 'Bearer pending-teen-token' }
    await api
      .get(PATH)
      .set(headers)
      .expect(200, { data: EMPTY })
      .expect('cache-control', 'private, no-store')
    await api
      .patch(PATH)
      .set(headers)
      .send({})
      .expect(200, { data: { ...EMPTY, mood: 'cozy' } })

    expect(canTeenAccessNonUploadSurface).toHaveBeenCalledTimes(2)
    expect(canTeenAccessNonUploadSurface).toHaveBeenCalledWith(OWNER)
    expect(canTeenAccess).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: OWNER } })
    )
  })

  it('rejects unknown fields and scopes updates and clear to the bearer owner', async () => {
    const api = request(httpTestUrl(app))
    const headers = { authorization: 'Bearer pending-teen-token' }
    await api
      .patch(PATH)
      .set(headers)
      .send({ mood: 'chic', userId: 'different-account' })
      .expect(400)
    expect(upsert).not.toHaveBeenCalled()

    const body = { mood: 'chic' }
    upsert.mockResolvedValueOnce({ ...EMPTY, ...body })
    await api
      .patch(PATH)
      .set(headers)
      .send(body)
      .expect(200, { data: { ...EMPTY, ...body } })
      .expect('cache-control', 'private, no-store')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: OWNER },
        create: { user_id: OWNER, ...body },
        update: body,
      })
    )

    await api
      .delete(PATH)
      .set(headers)
      .expect(200, { data: EMPTY })
      .expect('cache-control', 'private, no-store')
    expect(deleteMany).toHaveBeenCalledWith({ where: { user_id: OWNER } })
  })

  it('rejects signed-out and suspended members before reading or mutating answers', async () => {
    const api = request(httpTestUrl(app))
    await api.get(PATH).expect(401)
    canTeenAccessNonUploadSurface.mockResolvedValue(false)
    const headers = { authorization: 'Bearer suspended-teen-token' }
    await api.patch(PATH).set(headers).send({ mood: 'cozy' }).expect(403)
    await api.delete(PATH).set(headers).expect(403)
    expect(findUnique).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })
})
