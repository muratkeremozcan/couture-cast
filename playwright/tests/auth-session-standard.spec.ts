import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  authStorageInit,
  getTokenFilePath,
} from '@seontechnologies/playwright-utils/auth-session'
import { expect, test } from '../support/fixtures/merged-fixtures'
import coutureCastAuthProvider from '../support/auth-session/custom-auth-provider'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'

const authSessionUserIdentifier = 'guardian-standard-smoke-cookie'
const webBaseUrl =
  process.env.WEB_E2E_BASE_URL ?? process.env.WEB_BASE_URL ?? 'http://localhost:3005'
const authSessionCookieName =
  process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'couturecast-e2e-auth'

test.describe('Auth-session standard fixture', () => {
  test.use({
    authSessionEnabled: true,
    authOptions: {
      baseUrl: webBaseUrl,
      userIdentifier: authSessionUserIdentifier,
    },
  })

  test('[P1] applies persisted auth state through the standard merged fixture', async ({
    authToken,
    context,
  }) => {
    expect(authToken).toBeTruthy()
    const parts = authToken.split('.')
    expect(parts).toHaveLength(3)
    expect(parts[2]).toBe('couturecast-mobile-e2e')
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      exp: number
    }
    expect(claims).toMatchObject({
      sub: 'guardian-1',
      role: 'guardian',
      e2e: 'couturecast-mobile-e2e',
    })
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60)

    await expect
      .poll(async () => {
        const storageState = await context.storageState()
        return storageState.cookies.some(
          (cookie) => cookie.name === authSessionCookieName && cookie.value === authToken
        )
      })
      .toBe(true)
  })
})

test.describe('Auth-session cached bearer migration', () => {
  test.use({ authSessionEnabled: false })

  for (const [index, token] of [
    'test-token:guardian:guardian-1',
    'test-token-guardian',
    'test-token',
    `test-token.${Buffer.from(
      JSON.stringify({
        sub: 'guardian-1',
        role: 'guardian',
        e2e: 'couturecast-mobile-e2e',
      })
    ).toString('base64url')}.couturecast-mobile-e2e`,
  ].entries()) {
    test(`refreshes cached bearer without exp ${index}: ${token.split('.')[0]}`, async ({
      request,
    }) => {
      const options = {
        environment: 'local',
        userIdentifier: `guardian-cache-migration-${randomUUID()}`,
        baseUrl: webBaseUrl,
      }
      authStorageInit(options)
      const tokenPath = getTokenFilePath(options)
      try {
        fs.writeFileSync(
          tokenPath,
          JSON.stringify({
            cookies: [
              {
                name: authSessionCookieName,
                value: token,
                domain: new URL(webBaseUrl).hostname,
                path: '/',
                expires: Math.floor(Date.now() / 1000) + 3600,
                httpOnly: true,
                secure: false,
                sameSite: 'Lax',
              },
            ],
            origins: [],
          })
        )
        const state = await coutureCastAuthProvider.manageAuthToken(request, options)
        const refreshed = coutureCastAuthProvider.extractToken(state)
        expect(refreshed).toBeTruthy()
        expect(refreshed).not.toBe(token)
        expect(coutureCastAuthProvider.isTokenExpired?.(refreshed!)).toBe(false)
        expect(
          coutureCastAuthProvider.extractToken(
            JSON.parse(fs.readFileSync(tokenPath, 'utf8')) as Record<string, unknown>
          )
        ).toBe(refreshed)
        const reused = await coutureCastAuthProvider.manageAuthToken(request, options)
        expect(coutureCastAuthProvider.extractToken(reused)).toBe(refreshed)
      } finally {
        coutureCastAuthProvider.clearToken(options)
      }
    })
  }

  test('retains explicit role and identity in the shared token helper', () => {
    for (const role of ['admin', 'guardian', 'moderator', 'teen'] as const) {
      const token = localE2EAccessToken('isolated-member', role)
      const claims = JSON.parse(
        Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')
      ) as { exp: number }
      expect(claims).toMatchObject({ sub: 'isolated-member', role })
      expect(Number.isInteger(claims.exp)).toBe(true)
      expect(coutureCastAuthProvider.isTokenExpired?.(token)).toBe(false)
    }
  })
})
