import { test as base } from '@playwright/test'
import { resolveEnvironmentConfig } from '../config/environments'

type LoginOptions = {
  email?: string
  password?: string
}

type AuthFixture = {
  auth: {
    loginAs: (options?: LoginOptions) => Promise<void>
    logout: () => Promise<void>
  }
}

export const test = base.extend<AuthFixture>({
  auth: async ({ page }, use) => {
    const env = resolveEnvironmentConfig(process.env.TEST_ENV)

    const loginAs = async (options?: LoginOptions) => {
      const creds = {
        ...env.credentials.defaultUser,
        ...(options ?? {}),
      }

      await page.goto('/login')
      await page.fill('[data-testid="email"]', creds.email)
      await page.fill('[data-testid="password"]', creds.password)
      await page.click('[data-testid="submit-login"]')
      await page.waitForURL('**/dashboard')
    }

    const logout = async () => {
      await page.goto('/settings')
      await page.click('[data-testid="logout-button"]')
      await page.waitForURL('**/login')
    }

    await use({
      loginAs,
      logout,
    })
  },
})
