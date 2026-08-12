// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
import path from 'node:path'
import {
  createSavedLocationResponseSchema,
  garmentListResponseSchema,
  ritualResponseSchema,
  signupResponseSchema,
} from '@couture/api-client/contracts/http'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'

const environment = resolveEnvironmentConfig('local')
const garmentFixturePath = path.resolve(
  __dirname,
  '../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)

type WardrobeCleanupState = {
  userId?: string
  accessToken?: string
}

const wardrobeTest = test.extend<{ cleanupState: WardrobeCleanupState }>({
  cleanupState: async ({ apiRequest }, use) => {
    const state: WardrobeCleanupState = {}
    try {
      await use(state)
    } finally {
      await cleanupWardrobeUserTestData(
        apiRequest,
        state.accessToken,
        state.userId,
        environment.apiBaseUrl
      )
    }
  },
})

wardrobeTest.describe('Wardrobe Smart Tagging Flow', () => {
  // This journey authenticates as its API-created user instead of the default persisted session.
  wardrobeTest.use({ authSessionEnabled: false })

  wardrobeTest.beforeEach(({}, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'The smart-tagging system journey requires the supervised local API and fixture wardrobe worker.'
    )
  })

  wardrobeTest(
    '[P0] [4.2-E2E-001] uploads, resumes, confirms, reloads, and uses the garment in a Ritual',
    async ({ apiRequest, cleanupState, page, recurse }, testInfo) => {
      const accessToken =
        await test.step('Create an isolated wardrobe user', async () => {
          const signup = await apiRequest({
            method: 'POST',
            path: '/api/v1/auth/signup',
            baseUrl: environment.apiBaseUrl,
            body: {
              email: `${buildUniqueId('wardrobe-smart-tagging', testInfo)}@example.test`,
              birthdate: '1990-06-15',
            },
          })
          expect(signup.status).toBe(201)
          const signupBody = signupResponseSchema.parse(signup.body)
          cleanupState.userId = signupBody.userId
          const token = `test-token:guardian:${signupBody.userId}`
          cleanupState.accessToken = token

          const location = await apiRequest({
            method: 'POST',
            path: '/api/v1/locations',
            baseUrl: environment.apiBaseUrl,
            headers: { Authorization: `Bearer ${token}` },
            body: {
              label: 'Chicago',
              locationKey: buildUniqueId('chicago-smart-tagging', testInfo),
              latitude: 41.878,
              longitude: -87.63,
              timezone: 'America/Chicago',
            },
          })
          expect(location.status).toBe(201)
          createSavedLocationResponseSchema.parse(location.body)
          return token
        })

      await test.step('Upload a garment through the browser', async () => {
        await page.addInitScript((token) => {
          window.sessionStorage.setItem('couturecast.access-token', token)
        }, accessToken)
        await page.setExtraHTTPHeaders({ Authorization: `Bearer ${accessToken}` })

        await page.goto('/wardrobe')
        await waitForAccessibilityReady(page)
        await expect(
          page.getByRole('heading', { level: 1, name: 'Wardrobe Hub' })
        ).toBeVisible()

        await page.getByRole('button', { name: '+ Add Garment' }).click()
        await page.getByLabel('Garment image file').setInputFiles(garmentFixturePath)
        await page.getByRole('button', { name: 'Use This Image' }).click()
        await expect(page.getByText('Garment Upload Complete!')).toBeVisible()
        await page.getByRole('button', { name: 'Done' }).click()
      })

      const awaitingGarment =
        await test.step('Poll the worker-backed garment lifecycle with recurse', async () => {
          const response = await recurse(
            () =>
              apiRequest({
                method: 'GET',
                path: '/api/v1/wardrobe/garments',
                baseUrl: environment.apiBaseUrl,
                headers: { Authorization: `Bearer ${accessToken}` },
              }),
            ({ status, body }) => {
              const parsed = garmentListResponseSchema.safeParse(body)
              return (
                status === 200 &&
                parsed.success &&
                parsed.data.data.some((garment) => garment.status === 'awaiting_tags')
              )
            },
            {
              timeout: 20_000,
              interval: 250,
              log: 'Waiting for wardrobe worker smart-tag analysis',
            }
          )
          expect(response.status).toBe(200)
          const wardrobe = garmentListResponseSchema.parse(response.body)
          const garment = wardrobe.data.find(
            (candidate) => candidate.status === 'awaiting_tags'
          )
          expect(garment).toBeDefined()
          return garment!
        })

      await test.step('Cancel and resume the accessible tagging flow', async () => {
        const dialog = page.getByRole('dialog', { name: 'Organize Garment Tags' })
        await expect(dialog).toBeVisible()
        await checkA11y(page, {
          includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
          disableRules: ['color-contrast'],
        })

        await page.getByRole('button', { name: 'Cancel' }).click()
        const resumeButton = page.getByRole('button', { name: 'Needs tags' })
        await expect(resumeButton).toBeVisible()
        await resumeButton.click()
        await expect(dialog).toBeVisible()
      })

      await test.step('Override the suggestion with the keyboard and save', async () => {
        await expect(
          page
            .getByRole('radiogroup', { name: 'Target Comfort Range' })
            .getByRole('radio', { checked: true })
        ).toBeVisible()

        const categoryGroup = page.getByRole('radiogroup', {
          name: 'Garment Category',
        })
        const topChip = categoryGroup.getByRole('radio', { name: 'Top', exact: true })
        await topChip.focus()
        await expect(topChip).toBeFocused()
        await topChip.press('ArrowRight')
        const bottomChip = categoryGroup.getByRole('radio', {
          name: 'Bottom',
          exact: true,
        })
        await expect(bottomChip).toBeFocused()
        await bottomChip.press('Space')
        await expect(bottomChip).toHaveAttribute('aria-checked', 'true')

        await page.getByRole('button', { name: 'Confirm & Save Tags' }).click()
        await expect(
          page.getByRole('dialog', { name: 'Organize Garment Tags' })
        ).not.toBeVisible()
        await expect(
          page
            .getByTestId(`garment-card-${awaitingGarment.id}`)
            .getByText('ready', { exact: true })
        ).toBeVisible()
      })

      await test.step('Verify persistence after a browser reload', async () => {
        await page.reload()
        await expect(
          page
            .getByTestId(`garment-card-${awaitingGarment.id}`)
            .getByText('ready', { exact: true })
        ).toBeVisible()
        await expect(page.getByRole('button', { name: 'Needs tags' })).toHaveCount(0)
      })

      await test.step('Verify the confirmed garment is eligible for Ritual', async () => {
        const wardrobeResponse = await apiRequest({
          method: 'GET',
          path: '/api/v1/wardrobe/garments',
          baseUrl: environment.apiBaseUrl,
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        expect(wardrobeResponse.status).toBe(200)
        const wardrobe = garmentListResponseSchema.parse(wardrobeResponse.body)
        expect(wardrobe.data).toContainEqual(
          expect.objectContaining({ id: awaitingGarment.id, status: 'ready' })
        )

        const ritualResponse = await apiRequest({
          method: 'GET',
          path: '/api/v1/ritual',
          baseUrl: environment.apiBaseUrl,
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        expect(ritualResponse.status).toBe(200)
        const ritual = ritualResponseSchema.parse(ritualResponse.body)
        expect(
          ritual.data.outfits.some((outfit) =>
            outfit.garmentIds.includes(awaitingGarment.id)
          )
        ).toBe(true)
      })
    }
  )
})
