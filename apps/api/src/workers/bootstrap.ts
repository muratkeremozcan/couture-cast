import '../load-env'
import type { Queue, Worker } from 'bullmq'
import { Expo } from 'expo-server-sdk'
import Redis from 'ioredis'
import { createQueues, queueConfigs } from '../config/queues'
import { getRedisConfig, redisOptionsFromConfig } from '../config/redis'
import { AlertFanoutProcessor } from '../modules/alerts/alert-fanout.processor'
import { TelemetryService } from '../modules/telemetry/telemetry.service.js'
import { PostHogService } from '../posthog/posthog.service.js'
import { PrismaAlertFanoutRepository } from '../modules/alerts/alert-fanout.repository'
import {
  ALERT_REALTIME_PUBLISH_TIMEOUT_MS,
  RedisAlertRealtimePublisher,
} from '../modules/alerts/redis-alert-realtime.publisher'
import { PrismaWeatherAlertProcessingRepository } from '../modules/alerts/weather-alert-processing.repository'
import { WeatherAlertProcessingService } from '../modules/alerts/weather-alert-processing.service'
import {
  WeatherAlertFanoutQueue,
  type AlertFanoutJobData,
} from '../modules/alerts/weather-alert-fanout.queue'
import {
  BILLING_RECONCILIATION_JOB_NAME,
  COMMERCE_RETENTION_JOB_NAME,
  registerBillingReconciliationSchedulers,
} from '../modules/commerce/billing-reconciliation.scheduler'
import { BillingReconciliationService } from '../modules/commerce/billing-reconciliation.service'
import { CommerceRepository } from '../modules/commerce/commerce.repository'
import { CommerceRetentionService } from '../modules/commerce/commerce-retention.service'
import { PremiumEntitlementService } from '../modules/commerce/premium-entitlement.service'
import { resolveRevenueCatClient } from '../modules/commerce/revenuecat-client'
import { resolveStripeClient } from '../modules/commerce/stripe-client'
import { PushNotificationService } from '../modules/notifications/push-notification.service'
import { PushTokenRepository } from '../modules/notifications/push-token.repository'
import { loadWeatherConfig } from '../modules/weather/providers/weather.config'
import { OpenWeatherProvider } from '../modules/weather/providers/openweather.provider'
import { WeatherApiProvider } from '../modules/weather/providers/weatherapi.provider'
import { WeatherIngestionService } from '../modules/weather/weather-ingestion.service'
import { createWeatherJobProcessor } from '../modules/weather/weather-processor'
import { WeatherQueryService } from '../modules/weather/weather-query.service'
import { WeatherRepository } from '../modules/weather/weather.repository'
import { registerWeatherRefreshScheduler } from '../modules/weather/weather-scheduler'
import {
  CombinedWeatherTargetSource,
  ConfiguredWeatherTargetSource,
  SavedLocationWeatherTargetSource,
} from '../modules/weather/weather-target-source'
import { createBaseLogger } from '../logger/pino.config.js'
import { createWorker, defaultWorkerOptions } from './base.worker'
import { disconnectPrismaClient, getPrismaClient } from './prisma'
import { shutdownWorkerResources } from './shutdown-resources'

// Flow ref S0.4/T5: track worker/queue instances for coordinated shutdown.
const logger = createBaseLogger().child({ feature: 'workers' })
const workers: Worker[] = []
const queues: Queue[] = []
const redisClients: Redis[] = []
let posthogService: PostHogService | undefined

async function startWorkers() {
  try {
    // Flow ref S0.4/T5: create queue clients for the known queues before any
    // workers start consuming jobs.
    const startedQueues = createQueues()
    queues.push(...startedQueues)
    const weatherQueue = startedQueues.find((queue) => queue.name === 'weather-ingestion')
    const alertFanoutQueue = startedQueues.find((queue) => queue.name === 'alert-fanout')
    const colorExtractionQueue = startedQueues.find(
      (queue) => queue.name === 'color-extraction'
    )
    const billingReconciliationQueue = startedQueues.find(
      (queue) => queue.name === 'billing-reconciliation'
    )

    if (
      !weatherQueue ||
      !alertFanoutQueue ||
      !colorExtractionQueue ||
      !billingReconciliationQueue
    ) {
      throw new Error(
        'Required weather-ingestion, alert-fanout, color-extraction, and billing-reconciliation queues were not created'
      )
    }

    const weatherConfig = loadWeatherConfig()
    const prisma = getPrismaClient()
    const redisConfig = getRedisConfig()
    const alertRelayRedis = new Redis(redisConfig.url, {
      ...redisOptionsFromConfig(redisConfig),
      commandTimeout: ALERT_REALTIME_PUBLISH_TIMEOUT_MS,
      connectTimeout: ALERT_REALTIME_PUBLISH_TIMEOUT_MS,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    })
    redisClients.push(alertRelayRedis)
    posthogService = new PostHogService()
    const telemetryService = new TelemetryService(prisma, posthogService)
    const alertFanoutProcessor = new AlertFanoutProcessor(
      new PrismaAlertFanoutRepository(prisma),
      new RedisAlertRealtimePublisher(alertRelayRedis),
      new PushNotificationService(
        new PushTokenRepository(prisma),
        new Expo({ accessToken: process.env.EXPO_TOKEN })
      ),
      telemetryService
    )
    const weatherRepository = new WeatherRepository(prisma)
    const weatherQueryService = new WeatherQueryService(weatherRepository)
    const weatherAlertProcessor = new WeatherAlertProcessingService(
      new PrismaWeatherAlertProcessingRepository(prisma),
      undefined,
      new WeatherAlertFanoutQueue(alertFanoutQueue)
    )
    const weatherIngestionService = new WeatherIngestionService(
      new OpenWeatherProvider(),
      new WeatherApiProvider(),
      weatherRepository,
      weatherQueryService,
      undefined,
      undefined,
      undefined,
      undefined,
      weatherAlertProcessor
    )
    const baseLogger = logger
    const weatherProcessor = createWeatherJobProcessor({
      queue: weatherQueue,
      targetSource: new CombinedWeatherTargetSource([
        new SavedLocationWeatherTargetSource(prisma),
        new ConfiguredWeatherTargetSource(),
      ]),
      ingestionService: weatherIngestionService,
      alertDispatcher: weatherAlertProcessor,
      refreshMinutes: weatherConfig.refreshMinutes,
      logger: baseLogger,
    })

    await registerWeatherRefreshScheduler(weatherQueue, weatherConfig)

    // Story 5.2 Decision 4a: billing reconciliation + commerce retention run
    // here — the worker runtime is the only substrate in this repo where
    // schedules provably fire (the serverless API's @Cron never has).
    const revenueCatClient = resolveRevenueCatClient()
    const premiumEntitlementService = new PremiumEntitlementService(
      prisma,
      revenueCatClient,
      resolveStripeClient()
    )
    const billingReconciliationService = new BillingReconciliationService(
      prisma,
      revenueCatClient,
      premiumEntitlementService,
      telemetryService
    )
    const commerceRetentionService = new CommerceRetentionService(
      new CommerceRepository(prisma)
    )

    await registerBillingReconciliationSchedulers(billingReconciliationQueue)

    // Flow ref S0.4/T4: start one worker per queue with the queue-specific
    // concurrency and optional rate limiter policy.
    workers.push(
      // Weather provider calls are bounded in-service; worker concurrency stays capped.
      createWorker('weather-ingestion', weatherProcessor, {
        ...defaultWorkerOptions(5),
        limiter: { max: 60, duration: 60_000 },
      })
    )

    workers.push(
      // Fanout is lightweight enough for higher parallelism and no extra rate limiter.
      createWorker(
        'alert-fanout',
        async (job) => {
          await alertFanoutProcessor.process(job.data as AlertFanoutJobData)
        },
        {
          ...defaultWorkerOptions(20),
        }
      )
    )

    workers.push(
      // One consumer, one process group (the bootstrap.ts:144-151 rule): both
      // billing jobs are DB/HTTP-bound sweeps, serial on purpose so a slow
      // ledger cannot stack concurrent sweeps against RC's rate limits.
      createWorker(
        'billing-reconciliation',
        async (job) => {
          if (job.name === BILLING_RECONCILIATION_JOB_NAME) {
            await billingReconciliationService.sweep()
            return
          }
          if (job.name === COMMERCE_RETENTION_JOB_NAME) {
            await commerceRetentionService.pruneExpiredCommerceRecords()
            return
          }
          logger.warn({ jobName: job.name }, 'Unknown billing-reconciliation job')
        },
        {
          ...defaultWorkerOptions(1),
        }
      )
    )

    // Story 4.4: the moderation-review consumer moved to
    // wardrobe.bootstrap.ts, the model-capable process gated by
    // verify:tagging-model. BullMQ splits jobs nondeterministically across
    // every Worker instance subscribed to the same queue name regardless of
    // process, so this lightweight process group must not also subscribe --
    // leaving both running would silently "succeed" a fraction of
    // silhouette jobs without ever running moderation.

    logger.info({ queues: queueConfigs.map((q) => q.name) }, 'Workers started for queues')
  } catch (err) {
    logger.error(err, 'Failed to start workers')
    process.exit(1)
  }
}

async function performShutdown() {
  logger.info('Shutting down workers and queues...')
  let exitCode = 0
  try {
    if (posthogService) {
      try {
        posthogService.onApplicationShutdown()
      } catch (err) {
        logger.error(err, 'Error shutting down PostHogService')
      }
    }
    await shutdownWorkerResources({
      workers,
      queues,
      redisClients,
      disconnectPrisma: disconnectPrismaClient,
    })
  } catch (err) {
    logger.error(err, 'Error closing workers or queues')
    exitCode = 1
  } finally {
    process.exit(exitCode)
  }
}

let shutdownPromise: Promise<void> | undefined

function shutdown(): Promise<void> {
  shutdownPromise ??= performShutdown()
  return shutdownPromise
}

// Flow ref S0.4/T5: handle SIGTERM/SIGINT and close resources cleanly.
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

void startWorkers()
