import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import { PrismaClient } from '@prisma/client'
import type { INestApplication } from '@nestjs/common'
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  engagementHarness,
  type EngagementHarness,
} from './helpers/community-engagement-harness.js'
import { listenHttpApp } from '../src/testing/loopback-http-app.js'
import type { TelemetryService } from '../src/modules/telemetry/telemetry.service.js'
import type * as NotificationsRuntime from '../src/modules/notifications/notifications.module.js'
import type * as PushRuntime from '../src/modules/notifications/push-notification.service.js'
import type * as FanoutRuntime from '../src/modules/alerts/alert-fanout.processor.js'
import type * as FanoutRepositoryRuntime from '../src/modules/alerts/alert-fanout.repository.js'
import type * as WorkersRuntime from '../src/workers/bootstrap.js'
// Use actual Nest-compiled decorator metadata; source esbuild omits constructor metadata.
const built = createRequire(resolve(__dirname, '../package.json'))
const { NotificationsModule } = built(
  './dist/src/modules/notifications/notifications.module.js'
) as typeof NotificationsRuntime
const { EXPO_CLIENT, PushNotificationService } = built(
  './dist/src/modules/notifications/push-notification.service.js'
) as typeof PushRuntime
const { AlertFanoutProcessor } = built(
  './dist/src/modules/alerts/alert-fanout.processor.js'
) as typeof FanoutRuntime
const { PrismaAlertFanoutRepository } = built(
  './dist/src/modules/alerts/alert-fanout.repository.js'
) as typeof FanoutRepositoryRuntime
const { createStandaloneWeatherFanout } = built(
  './dist/src/workers/bootstrap.js'
) as typeof WorkersRuntime
let h: EngagementHarness
let app: INestApplication | undefined
let pendingFanout: Promise<unknown> | undefined
beforeEach(async () => {
  h = await engagementHarness()
  vi.stubEnv('TEST_ENV', 'local')
}, 30_000)
afterEach(async () => {
  await h?.provider.call('release', 'invalid')
  await pendingFanout
  pendingFanout = undefined
  await app?.close()
  app = undefined
  await h?.close()
  vi.unstubAllEnvs()
}, 30_000)
const ticketSchema = z.union([
  z.object({ status: z.literal('ok'), id: z.string() }),
  z.object({
    status: z.literal('error'),
    message: z.string(),
    details: z.object({ error: z.literal('DeviceNotRegistered') }),
  }),
])
describe('6.5-INT-019..024 held real weather fanout binding transfer', () => {
  it.each([
    { composition: 'Nest NotificationsModule', transferred: true },
    { composition: 'standalone worker factory', transferred: true },
    { composition: 'Nest NotificationsModule', transferred: false },
    { composition: 'standalone worker factory', transferred: false },
  ])(
    '$composition invalid ticket cleanup is generation-safe with transferred=$transferred',
    async ({ composition, transferred }) => {
      const f = await h.fixture()
      const expo = {
        sendPushNotificationsAsync: async (
          messages: ExpoPushMessage[]
        ): Promise<ExpoPushTicket[]> =>
          Promise.all(
            messages.map(async (message) => {
              const response = await fetch(h.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(message),
              })
              const result = z.object({ data: ticketSchema }).parse(await response.json())
              return result.data
            })
          ),
      }
      const module = await Test.createTestingModule({ imports: [NotificationsModule] })
        .overrideProvider(PrismaClient)
        .useValue(h.prisma)
        .overrideProvider(EXPO_CLIENT)
        .useValue(expo)
        .compile()
      app = module.createNestApplication()
      app.useLogger(false)
      const base = await listenHttpApp(app)
      const realtime = { publish: () => Promise.resolve(false) }
      const telemetry = {
        captureEvent: () => Promise.resolve(),
      } as unknown as TelemetryService
      const processor =
        composition === 'Nest NotificationsModule'
          ? new AlertFanoutProcessor(
              new PrismaAlertFanoutRepository(h.prisma),
              realtime,
              app.get(PushNotificationService),
              telemetry
            )
          : createStandaloneWeatherFanout(h.prisma, realtime, telemetry, expo)
      const event = await h.prisma.eventEnvelope.create({
        data: {
          channel: 'alert:weather',
          user_id: f.recipient.id,
          payload: {
            version: '1',
            timestamp: new Date().toISOString(),
            userId: f.recipient.id,
            data: {
              alertType: 'severe',
              location: 'Synthetic location',
              message: 'Controlled weather alert',
              severity: 'critical',
            },
          },
        },
      })
      await h.provider.call('mode', 'hold')
      const fanout = processor.process({ eventId: event.id }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
      pendingFanout = fanout
      await h.provider.event('request')
      let current = {
        registrationId: f.binding.registrationId,
        bindingGeneration: f.binding.bindingGeneration,
      }
      if (transferred) {
        // Actual authenticated HTTP transfers the identical token/installation while the old send is held.
        const transfer = await fetch(`${base}/api/v1/notifications/push-tokens`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer test-token:guardian:${f.actor.id}`,
          },
          body: JSON.stringify({
            token: f.token,
            installationId: f.installation,
            platform: 'ios',
            permission: 'granted',
            transfer: true,
            expectedBinding: {
              registrationId: f.binding.registrationId,
              bindingGeneration: f.binding.bindingGeneration,
            },
          }),
        })
        expect(transfer.status).toBe(200)
        current = z
          .object({
            data: z.object({ registrationId: z.string(), bindingGeneration: z.number() }),
          })
          .parse(await transfer.json()).data
        expect(current.registrationId).toBe(f.binding.registrationId)
        expect(current.bindingGeneration).toBeGreaterThan(f.binding.bindingGeneration)
      }
      await h.provider.call('release', 'invalid')
      const result = await fanout
      expect(result).toHaveProperty('error')
      if (!('error' in result))
        throw new Error('Invalid ticket should reject the weather job')
      expect(result.error).toMatchObject({ name: 'AlertPushDeliveryRejectedError' })
      const audit = await h.prisma.auditLog.findFirstOrThrow({
        where: { user_id: f.recipient.id, event_type: 'weather_alert_fanout' },
        orderBy: { timestamp: 'desc' },
      })
      expect(audit.event_data).toMatchObject({
        invalidTokenCount: 1,
        prunedInvalidTokenCount: transferred ? 0 : 1,
        invalidTokenPruneFailed: false,
      })
      const stored = await h.prisma.pushToken.findUnique({
        where: { id: current.registrationId },
      })
      if (transferred) {
        expect(stored).toMatchObject({
          user_id: f.actor.id,
          binding_generation: current.bindingGeneration,
        })
        expect(
          await h.prisma.communityTokenDelivery.findUnique({
            where: { id: f.delivery.id },
          })
        ).toMatchObject({ status: 'suppressed' })
      } else expect(stored).toBeNull()
      // Retrying the old weather job cannot send to the transferred binding or a deleted token.
      await processor.process({ eventId: event.id })
      expect(await h.ledger()).toHaveLength(1)
    },
    10_000
  )
})
