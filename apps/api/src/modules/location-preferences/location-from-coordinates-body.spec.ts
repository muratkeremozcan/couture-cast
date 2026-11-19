// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), Codex review 3 finding 5: the from-coordinates body carries
// the member's rounded position. A body that is not valid JSON fails in Express's JSON parser
// before the controller validates anything, and the parser's diagnostic (which can quote the body)
// used to reach the client through the global exception filter. This runs the deployed wiring
// (configureApp: the request logger and ApiExceptionFilter) and asserts a fixed 400 envelope that
// echoes nothing of the body, and that no service call happens.
import 'reflect-metadata'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locationRequestErrorResponseSchema } from '@couture/api-client/contracts/http'
import { configureApp } from '../../bootstrap/configure-app.js'
import type { TelemetryService } from '../telemetry/telemetry.service.js'
import { listenHttpApp, httpTestUrl } from '../../testing/loopback-http-app.js'
import type { AccessTokenIdentityService } from '../auth/access-token-identity.service.js'
import { GuardianConsentStateService } from '../auth/guardian-consent-state.service'
import { RequestAuthGuard } from '../auth/security.guards'
import { LocationCaptureService } from './location-capture.service'
import { LocationPreferencesController } from './location-preferences.controller'
import { LocationPreferencesService } from './location-preferences.service'

const PATH = '/api/v1/locations/from-coordinates'
const HEADERS = {
  authorization: 'Bearer location-token',
  'x-couture-platform': 'web',
  'content-type': 'application/json',
}
/** Anything a parser diagnostic could quote from these bodies. */
const BODY_TEXT = /41\.8|87\.6|latitude|longitude|Unexpected|JSON|position|token/i

describe('from-coordinates refuses a malformed body without echoing it', () => {
  let app: INestApplication | undefined
  const fromCoordinates = vi.fn()

  beforeEach(async () => {
    fromCoordinates.mockReset()
    const consent = {
      canTeenAccess: vi.fn().mockResolvedValue(true),
    } as unknown as GuardianConsentStateService
    const identity = {
      resolveIdentity: vi.fn((token: string) =>
        token === 'location-token'
          ? Promise.resolve({ userId: 'user-1', role: 'guardian' as const })
          : Promise.reject(new Error('Unknown test access token'))
      ),
    } as unknown as AccessTokenIdentityService

    const moduleFixture = await Test.createTestingModule({
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

    app = moduleFixture.createNestApplication()
    const telemetry = {
      captureEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryService
    configureApp(app, { telemetry, corsOrigins: [] })
    await listenHttpApp(app)
  })

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it.each([
    ['a truncated object', '{"latitude":41.88,"longitude":-87.6'],
    ['a trailing comma', '{"latitude":41.88,"longitude":-87.63,}'],
    ['unquoted names', '{latitude:41.88,longitude:-87.63}'],
    ['a bare token', 'latitude=41.88&longitude=-87.63'],
  ])(
    'LOC-COORD-BODY-01 %s gets the fixed invalid_request 400 and no service call',
    async (_case, body) => {
      const response = await request(httpTestUrl(app!)).post(PATH).set(HEADERS).send(body)

      expect(response.status).toBe(400)
      const error = locationRequestErrorResponseSchema.parse(response.body)
      expect(error.code).toBe('invalid_request')
      expect(JSON.stringify(response.body)).not.toMatch(BODY_TEXT)
      expect(fromCoordinates).not.toHaveBeenCalled()
    }
  )
})
