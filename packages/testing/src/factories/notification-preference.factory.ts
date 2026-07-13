import type {
  NotificationPreference as PrismaNotificationPreference,
  Prisma,
  PrismaClient,
} from '@prisma/client'

import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export interface NotificationPreferenceFixture {
  id: string
  userId: string
  quietHoursEnabled: boolean
  pushEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  timezone: string
  createdAt: Date
  updatedAt: Date
}

export type NotificationPreferenceFactoryOverrides =
  Partial<NotificationPreferenceFixture>
type PersistNotificationPreferencePrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedNotificationPreferenceOptions {
  persist: true
  prisma: PersistNotificationPreferencePrismaClient
}

export type PersistedNotificationPreferenceFixture = PrismaNotificationPreference

const mergeNotificationPreferenceFixture = createFactory<NotificationPreferenceFixture>(
  buildDefaultNotificationPreferenceFixture
)

function buildDefaultNotificationPreferenceFixture(): NotificationPreferenceFixture {
  const now = new Date()

  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    quietHoursEnabled: false,
    pushEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: 'UTC',
    createdAt: now,
    updatedAt: now,
  }
}

export function buildNotificationPreferenceCreateInput(
  fixture: NotificationPreferenceFixture
): Prisma.NotificationPreferenceUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    quiet_hours_enabled: fixture.quietHoursEnabled,
    push_enabled: fixture.pushEnabled,
    quiet_hours_start: fixture.quietHoursStart,
    quiet_hours_end: fixture.quietHoursEnd,
    timezone: fixture.timezone,
    created_at: fixture.createdAt,
    updated_at: fixture.updatedAt,
  }
}

export async function persistNotificationPreference(
  prisma: PersistNotificationPreferencePrismaClient,
  fixture: NotificationPreferenceFixture
): Promise<PersistedNotificationPreferenceFixture> {
  const preference = await prisma.notificationPreference.create({
    data: buildNotificationPreferenceCreateInput(fixture),
  })

  registerCreatedEntity('notificationPreferences', preference.id)
  return preference
}

export function createNotificationPreference(
  overrides?: NotificationPreferenceFactoryOverrides
): NotificationPreferenceFixture
export function createNotificationPreference(
  overrides: NotificationPreferenceFactoryOverrides | undefined,
  options: CreatePersistedNotificationPreferenceOptions
): Promise<PersistedNotificationPreferenceFixture>
export function createNotificationPreference(
  overrides: NotificationPreferenceFactoryOverrides = {},
  options?: CreatePersistedNotificationPreferenceOptions
): NotificationPreferenceFixture | Promise<PersistedNotificationPreferenceFixture> {
  const fixture = mergeNotificationPreferenceFixture(overrides)

  if (!options?.persist) {
    return fixture
  }

  return persistNotificationPreference(options.prisma, fixture)
}
