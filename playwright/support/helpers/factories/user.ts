import { faker } from '@faker-js/faker'

export type MembershipTier = 'free' | 'pro' | 'studio'

export type User = {
  id: string
  email: string
  firstName: string
  lastName: string
  membershipTier: MembershipTier
  preferredCity: string
  avatarUrl: string
  notificationsEnabled: boolean
}

export type OutfitRecommendation = {
  id: string
  userId: string
  temperatureHigh: number
  temperatureLow: number
  summary: string
  items: string[]
}

export const createUser = (overrides: Partial<User> = {}): User => ({
  id: faker.string.uuid(),
  email: faker.internet.email().toLowerCase(),
  firstName: faker.person.firstName(),
  lastName: faker.person.lastName(),
  membershipTier: 'free',
  preferredCity: faker.location.city(),
  avatarUrl: faker.image.avatar(),
  notificationsEnabled: true,
  ...overrides,
})

export const createProUser = (overrides: Partial<User> = {}): User =>
  createUser({
    membershipTier: 'pro',
    notificationsEnabled: true,
    ...overrides,
  })

export const createStudioUser = (overrides: Partial<User> = {}): User =>
  createUser({
    membershipTier: 'studio',
    notificationsEnabled: true,
    ...overrides,
  })

export const createOutfitRecommendation = (
  userId: string,
  overrides: Partial<OutfitRecommendation> = {}
): OutfitRecommendation => ({
  id: faker.string.uuid(),
  userId,
  temperatureHigh: faker.number.int({ min: 50, max: 95 }),
  temperatureLow: faker.number.int({ min: 32, max: 60 }),
  summary: faker.lorem.sentence(),
  items: [
    faker.commerce.productName(),
    faker.commerce.productName(),
    faker.commerce.productName(),
  ],
  ...overrides,
})
