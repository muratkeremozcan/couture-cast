import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMERCE_DISABLED_MESSAGE,
  COMMERCE_OFFER_NOT_FOUND_MESSAGE,
  COMMERCE_OPTED_OUT_MESSAGE,
} from '../../contracts/http.js'
import type { AuthenticatedRequest } from '../auth/security.types.js'
import { RequestAuthGuard } from '../auth/security.guards.js'
import { AffiliateClickController } from './affiliate-click.controller.js'
import { AffiliateClickService } from './affiliate-click.service.js'

/**
 * The `201` versus `200` distinction is the exact shape Story 4.4 shipped
 * broken: its unit test spied on a hand-built `res` object and stayed green when
 * the controller was reverted. These assertions go over real HTTP through a Nest
 * `TestingModule` and `supertest`, so reverting the `res.status(...)` line fails
 * them.
 */
describe('AffiliateClickController', () => {
  let app: INestApplication | undefined
  const clickService = { recordClick: vi.fn() }

  const validBody = {
    offerId: 'offer-1',
    recommendationId: 'rec-1',
    surface: 'mobile_hero',
  }

  beforeEach(async () => {
    clickService.recordClick.mockReset()

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AffiliateClickController],
      providers: [{ provide: AffiliateClickService, useValue: clickService }],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => AuthenticatedRequest }
        }) => {
          const req = context.switchToHttp().getRequest()
          if (req.headers.authorization !== 'Bearer commerce-token') {
            throw new UnauthorizedException('Missing or invalid bearer token')
          }
          req.auth = { token: 'commerce-token', userId: 'user-1', role: 'teen' }
          return true
        },
      })
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  const post = (body: object) => {
    if (!app) {
      throw new Error('App is not initialized')
    }
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/api/v1/commerce/affiliate/clicks')
      .set({ authorization: 'Bearer commerce-token' })
      .send(body)
  }

  it('answers 201 with the redirect URL on a fresh mint', async () => {
    clickService.recordClick.mockResolvedValue({
      redirectUrl: 'https://partner.couturecast.test/shop?cc=tok',
      created: true,
    })

    const response = await post(validBody)

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      data: { redirectUrl: 'https://partner.couturecast.test/shop?cc=tok' },
    })
  })

  it('answers 200 with the same redirect URL on a deduped replay', async () => {
    clickService.recordClick.mockResolvedValue({
      redirectUrl: 'https://partner.couturecast.test/shop?cc=tok',
      created: false,
    })

    const response = await post(validBody)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      data: { redirectUrl: 'https://partner.couturecast.test/shop?cc=tok' },
    })
  })

  it('forwards the resolved locale header so the region is derived server-side', async () => {
    clickService.recordClick.mockResolvedValue({
      redirectUrl: 'https://x.test/',
      created: true,
    })
    if (!app) {
      throw new Error('App is not initialized')
    }

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/api/v1/commerce/affiliate/clicks')
      .set({ authorization: 'Bearer commerce-token', 'accept-language': 'fr-CA' })
      .send(validBody)

    expect(clickService.recordClick).toHaveBeenCalledWith({
      ...validBody,
      userId: 'user-1',
      acceptLanguage: 'fr-CA',
    })
  })

  it('requires authentication', async () => {
    if (!app) {
      throw new Error('App is not initialized')
    }

    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/api/v1/commerce/affiliate/clicks')
      .send(validBody)

    expect(response.status).toBe(401)
    expect(clickService.recordClick).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'a missing offerId',
      body: { recommendationId: 'rec-1', surface: 'mobile_hero' },
    },
    { name: 'an unknown surface', body: { ...validBody, surface: 'web_hero' } },
    { name: 'a client-supplied scenario', body: { ...validBody, scenario: 'morning' } },
    {
      name: 'a client-supplied localeRegion',
      body: { ...validBody, localeRegion: 'US' },
    },
    { name: 'an over-long offerId', body: { ...validBody, offerId: 'o'.repeat(65) } },
  ])('rejects $name with 400 before reaching the service', async ({ body }) => {
    const response = await post(body)

    expect(response.status).toBe(400)
    expect(clickService.recordClick).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'the kill switch',
      error: new ServiceUnavailableException(COMMERCE_DISABLED_MESSAGE),
      status: 503,
      message: COMMERCE_DISABLED_MESSAGE,
    },
    {
      name: 'an opted-out user',
      error: new ForbiddenException(COMMERCE_OPTED_OUT_MESSAGE),
      status: 403,
      message: COMMERCE_OPTED_OUT_MESSAGE,
    },
    {
      name: 'an unknown offer',
      error: new NotFoundException(COMMERCE_OFFER_NOT_FOUND_MESSAGE),
      status: 404,
      message: COMMERCE_OFFER_NOT_FOUND_MESSAGE,
    },
  ])(
    'surfaces $name as its documented status and message',
    async ({ error, status, message }) => {
      clickService.recordClick.mockRejectedValue(error)

      const response = await post(validBody)

      expect(response.status).toBe(status)
      expect(response.body).toMatchObject({ statusCode: status, message })
      // Decision 9: the shared error envelopes are `.strict()` over exactly
      // { statusCode, message, error }. There is no `code` field on the wire.
      expect(response.body).not.toHaveProperty('code')
    }
  )
})
