import type { AlertRule as PrismaAlertRule, Prisma, PrismaClient } from '@prisma/client'

import { createFactory, faker } from './factory.js'
import { registerCreatedEntity } from './registry.js'

export type AlertRuleType = 'temperature' | 'precipitation' | 'severe'

export interface AlertRuleFixture {
  id: string
  userId: string
  ruleType: AlertRuleType
  threshold: number
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type AlertRuleFactoryOverrides = Partial<AlertRuleFixture>
type PersistAlertRulePrismaClient = PrismaClient | Prisma.TransactionClient

export interface CreatePersistedAlertRuleOptions {
  persist: true
  prisma: PersistAlertRulePrismaClient
}

export type PersistedAlertRuleFixture = PrismaAlertRule

const mergeAlertRuleFixture = createFactory<AlertRuleFixture>(
  buildDefaultAlertRuleFixture
)

function buildDefaultAlertRuleFixture(): AlertRuleFixture {
  const now = new Date()

  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    ruleType: 'temperature',
    threshold: 5,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function buildAlertRuleCreateInput(
  fixture: AlertRuleFixture
): Prisma.AlertRuleUncheckedCreateInput {
  return {
    id: fixture.id,
    user_id: fixture.userId,
    rule_type: fixture.ruleType,
    threshold: fixture.threshold,
    enabled: fixture.enabled,
    created_at: fixture.createdAt,
    updated_at: fixture.updatedAt,
  }
}

export async function persistAlertRule(
  prisma: PersistAlertRulePrismaClient,
  fixture: AlertRuleFixture
): Promise<PersistedAlertRuleFixture> {
  const alertRule = await prisma.alertRule.create({
    data: buildAlertRuleCreateInput(fixture),
  })

  registerCreatedEntity('alertRules', alertRule.id)
  return alertRule
}

export function createAlertRule(overrides?: AlertRuleFactoryOverrides): AlertRuleFixture
export function createAlertRule(
  overrides: AlertRuleFactoryOverrides | undefined,
  options: CreatePersistedAlertRuleOptions
): Promise<PersistedAlertRuleFixture>
export function createAlertRule(
  overrides: AlertRuleFactoryOverrides = {},
  options?: CreatePersistedAlertRuleOptions
): AlertRuleFixture | Promise<PersistedAlertRuleFixture> {
  const fixture = mergeAlertRuleFixture(overrides)

  if (!options?.persist) {
    return fixture
  }

  return persistAlertRule(options.prisma, fixture)
}
