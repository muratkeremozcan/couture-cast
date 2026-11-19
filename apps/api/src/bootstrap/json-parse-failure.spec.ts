// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), review finding: Express's JSON parser fails with a message
// that can quote the body, and Nest forwarded it to the client, so a malformed Use my location
// body could come back with its coordinates in the error. The wiring every bootstrap shares now
// answers every parse failure with one fixed 400.
import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listenHttpApp, httpTestUrl } from '../testing/loopback-http-app.js'
import type { AccessTokenIdentityService } from '../modules/auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../modules/auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../modules/auth/security.guards'
import { LocationCaptureService } from '../modules/location-preferences/location-capture.service'
import { LocationPreferencesController } from '../modules/location-preferences/location-preferences.controller'
import { LocationPreferencesService } from '../modules/location-preferences/location-preferences.service'
import type { TelemetryService } from '../modules/telemetry/telemetry.service'
import { configureApp } from './configure-app'

describe('JSON parse failures', () => {
  let app: INestApplication | undefined
  const fromCoordinates = vi.fn().mockResolvedValue([])

  beforeEach(async () => {
    const consent = {
      canTeenAccess: vi.fn().mockResolvedValue(true),
    } as unknown as GuardianConsentStateService
    const identity = {
      resolveIdentity: vi.fn(() =>
        Promise.resolve({ userId: 'user-1', role: 'guardian' as const })
      ),
    } as unknown as AccessTokenIdentityService
    const moduleRef = await Test.createTestingModule({
      controllers: [LocationPreferencesController],
      providers: [
        { provide: LocationPreferencesService, useValue: {} },
        { provide: LocationCaptureService, useValue: { fromCoordinates } },
        { provide: GuardianConsentStateService, useValue: consent },
      ],
    })
      .overrideGuard(RequestAuthGuard)
      .useValue(new RequestAuthGuard(consent, identity))
      .compile()

    app = moduleRef.createNestApplication({ rawBody: true })
    configureApp(app, {
      adapterHost: app.get(HttpAdapterHost),
      telemetry: {
        captureEvent: vi.fn().mockResolvedValue(undefined),
      } as unknown as TelemetryService,
      env: {},
    })
    await listenHttpApp(app)
  })

  afterEach(async () => {
    fromCoordinates.mockClear()
    await app?.close()
    app = undefined
  })

  it('JSON-PARSE-01 answers malformed coordinates with a fixed 400 that quotes none of the body', async () => {
    const response = await request(httpTestUrl(app!))
      .post('/api/v1/locations/from-coordinates')
      .set({
        authorization: 'Bearer location-token',
        'x-couture-platform': 'web',
        'content-type': 'application/json',
      })
      .send('{"latitude": 41.88, "longitude": -87.63x}')

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      statusCode: 400,
      code: 'invalid_request',
      message: 'The request body could not be read.',
      error: 'Bad Request',
    })
    expect(JSON.stringify(response.body)).not.toMatch(/41\.88|87\.63|latitude/)
    expect(fromCoordinates).not.toHaveBeenCalled()
  })

  it('JSON-PARSE-02 still parses a valid body', async () => {
    const response = await request(httpTestUrl(app!))
      .post('/api/v1/locations/from-coordinates')
      .set({ authorization: 'Bearer location-token', 'x-couture-platform': 'web' })
      .send({ latitude: 41.88, longitude: -87.63 })

    expect(response.status).toBe(200)
    expect(fromCoordinates).toHaveBeenCalledWith('user-1', 41.88, -87.63, 'en-US', 'web')
  })
})
