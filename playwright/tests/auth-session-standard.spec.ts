import { expect, test } from '../support/fixtures/merged-fixtures'

const authSessionUserIdentifier = 'guardian-standard-smoke-cookie'
const webBaseUrl =
  process.env.WEB_E2E_BASE_URL ?? process.env.WEB_BASE_URL ?? 'http://localhost:3005'

test.describe('Auth-session standard fixture', () => {
  test.use({
    authOptions: {
      baseUrl: webBaseUrl,
      environment: 'local',
      userIdentifier: authSessionUserIdentifier,
    },
  })

  test('[P1] applies persisted auth state through the standard merged fixture', async ({
    authToken,
    context,
  }) => {
    expect(authToken).toBeTruthy()

    await expect
      .poll(async () => {
        const storageState = await context.storageState()
        return storageState.cookies.some((cookie) => cookie.value === authToken)
      })
      .toBe(true)
  })
})
