// Learning path Step 77: Account style profile.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-77-account-style-profile
import type { TestInfo } from '@playwright/test'
import {
  signupResponseSchema,
  styleProfileResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect, test } from '../../support/fixtures/merged-fixtures'
import {
  createSignupPayload,
  resolveApiBaseUrl,
  type ApiRequestFixture,
} from '../../support/helpers/api-test'
import { localE2EAccessToken } from '../../support/helpers/local-e2e-token'
import { cleanupUserTestData } from '../../support/helpers/user-test-data'

const PATH = '/api/v1/personalization/style-profile'
const EMPTY_PROFILE = { mood: null, palette: null, texture: null, fit: null, avoid: [] }

function readProfile(response: Awaited<ReturnType<ApiRequestFixture>>) {
  expect(response.status).toBe(200)
  return styleProfileResponseSchema.parse(response.body).data
}

async function signup(
  apiRequest: ApiRequestFixture,
  testInfo: TestInfo,
  age: number,
  prefix: string
) {
  const response = await apiRequest({
    method: 'POST',
    path: '/api/v1/auth/signup',
    baseUrl: resolveApiBaseUrl(testInfo),
    body: createSignupPayload(testInfo, age, prefix),
  })
  expect(response.status).toBe(201)
  return signupResponseSchema.parse(response.body)
}

test.use({ authSessionEnabled: false })

test.describe('CC-7.20 style profile API @local-lane', () => {
  test('[P0] [7.20-ACCOUNT] answers persist by account, invalid writes leave them intact, and clear restores defaults', async ({
    apiRequest,
  }, testInfo) => {
    const baseUrl = resolveApiBaseUrl(testInfo)
    const userIds: string[] = []

    try {
      const adult = await signup(apiRequest, testInfo, 28, 'style-adult')
      userIds.push(adult.userId)
      expect(adult.accountStatus).toBe('active')
      const teen = await signup(apiRequest, testInfo, 15, 'style-teen')
      userIds.push(teen.userId)
      expect(teen.age).toBe(15)

      const owner = {
        path: PATH,
        baseUrl,
        headers: { authorization: `Bearer ${localE2EAccessToken(adult.userId)}` },
      }
      const other = {
        path: PATH,
        baseUrl,
        headers: { authorization: `Bearer ${localE2EAccessToken(teen.userId, 'teen')}` },
      }
      expect(readProfile(await apiRequest({ ...owner, method: 'GET' }))).toEqual(
        EMPTY_PROFILE
      )

      const mood = { mood: 'chic' }
      const first = { ...EMPTY_PROFILE, ...mood }
      expect(
        readProfile(await apiRequest({ ...owner, method: 'PATCH', body: mood }))
      ).toEqual(first)
      expect(readProfile(await apiRequest({ ...owner, method: 'GET' }))).toEqual(first)

      const tune = {
        palette: 'colorful',
        texture: 'textured',
        fit: 'relaxed',
        avoid: ['mini-skirt'],
      }
      const saved = { ...first, ...tune }
      expect(
        readProfile(await apiRequest({ ...owner, method: 'PATCH', body: tune }))
      ).toEqual(saved)
      expect(readProfile(await apiRequest({ ...owner, method: 'GET' }))).toEqual(saved)
      expect(readProfile(await apiRequest({ ...other, method: 'GET' }))).toEqual(
        EMPTY_PROFILE
      )

      const teenMood = { mood: 'cozy' }
      const teenProfile = { ...EMPTY_PROFILE, ...teenMood }
      expect(
        readProfile(await apiRequest({ ...other, method: 'PATCH', body: teenMood }))
      ).toEqual(teenProfile)
      for (const body of [
        { mood: 'user-written-mood' },
        { avoid: ['mini-skirt', 'mini-skirt'] },
        { mood: 'active', userId: teen.userId },
      ]) {
        expect((await apiRequest({ ...owner, method: 'PATCH', body })).status).toBe(400)
      }
      expect(readProfile(await apiRequest({ ...owner, method: 'GET' }))).toEqual(saved)

      expect(readProfile(await apiRequest({ ...owner, method: 'DELETE' }))).toEqual(
        EMPTY_PROFILE
      )
      expect(readProfile(await apiRequest({ ...owner, method: 'GET' }))).toEqual(
        EMPTY_PROFILE
      )
      expect(readProfile(await apiRequest({ ...other, method: 'GET' }))).toEqual(
        teenProfile
      )
    } finally {
      await Promise.all(userIds.map(cleanupUserTestData))
    }
  })

  test('[P0] [7.20-ACCOUNT] signed-out callers cannot read or change style answers', async ({
    apiRequest,
  }, testInfo) => {
    const route = { path: PATH, baseUrl: resolveApiBaseUrl(testInfo) }
    expect((await apiRequest({ ...route, method: 'GET' })).status).toBe(401)
    expect(
      (await apiRequest({ ...route, method: 'PATCH', body: { mood: 'chic' } })).status
    ).toBe(401)
    expect((await apiRequest({ ...route, method: 'DELETE' })).status).toBe(401)
  })
})
