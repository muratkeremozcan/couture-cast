// Story 4.2 Task 9 step 1 owner: E2E Playwright test for smart tagging modal accessibility and flow in playwright/tests/wardrobe-smart-tagging.spec.ts
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 76: Garment subtypes.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-76-garment-subtypes
// Learning path Step 84: Suggested tags that are right.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-84-suggested-tags-that-are-right
import path from 'node:path'
import {
  createSavedLocationResponseSchema,
  garmentListResponseSchema,
  ritualResponseSchema,
  signupResponseSchema,
  suggestGarmentTagsResponseSchema,
  WARDROBE_GARMENT_SUBTYPE_HEADER,
} from '@couture/api-client/contracts/http'
import { createSuggestGarmentTagsWireFixture } from '@couture/api-client/testing/wardrobe-fixtures'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { resolveEnvironmentConfig } from '../config/environments'
import { checkA11y, waitForAccessibilityReady } from '../support/helpers/accessibility'
import { buildUniqueId, isNonLocalEnvironment } from '../support/helpers/api-test'
import { cleanupWardrobeUserTestData } from '../support/helpers/user-test-data'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'

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
    async (
      { apiRequest, cleanupState, interceptNetworkCall, page, recurse },
      testInfo
    ) => {
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
          const token = localE2EAccessToken(signupBody.userId)
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
        // Story CC-7.11 D1: the tab title reads Closet.
        await expect(
          page.getByRole('heading', { level: 1, name: 'Closet' })
        ).toBeVisible()

        await page.getByRole('button', { name: '+ Add Garment' }).click()
        await page.getByLabel('Garment image file').setInputFiles(garmentFixturePath)
        await page.getByRole('button', { name: 'Use This Image' }).click()
        await expect(page.getByText('Piece added')).toBeVisible()
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

      const suggestionPath = `/api/v1/wardrobe/garments/${awaitingGarment.id}/suggest-tags`
      const suggestionUrl = `**${suggestionPath}`
      await test.step('Keep the legacy strict response usable without the subtype header', async () => {
        const originalClient = await apiRequest({
          method: 'POST',
          path: suggestionPath,
          baseUrl: environment.apiBaseUrl,
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        expect(originalClient.status).toBe(200)
        const result = suggestGarmentTagsResponseSchema.parse(originalClient.body).data
        expect(result).toMatchObject({
          mode: 'suggested',
          garmentId: awaitingGarment.id,
          suggestions: { category: { value: 'top', isConfident: true } },
        })
        expect(result).not.toHaveProperty('suggestions.subtype')
      })
      await test.step('Resume with the capture and confident chips on the same screen', async () => {
        const dialog = page.getByRole('dialog', { name: 'Organize Garment Tags' })
        await expect(dialog).toBeVisible()
        await checkA11y(page, {
          includedImpacts: ['critical', 'serious', 'moderate', 'minor'],
          disableRules: ['color-contrast'],
        })

        await page.getByRole('button', { name: 'Cancel' }).click()
        const resumeButton = page.getByRole('button', { name: 'Needs tags' })
        await expect(resumeButton).toBeVisible()
        // Reopening asks the API for the suggestions again. The local stack runs the fixture
        // tagging engine, so the real answer is `suggested` (Step 58: the response carries a
        // mode; `manual` is what a hosted worker without a model answers).
        const resumedSuggestions = interceptNetworkCall({
          method: 'POST',
          url: suggestionUrl,
        })
        await resumeButton.click()
        await expect(dialog).toBeVisible()
        const suggestCall = await resumedSuggestions
        expect(suggestCall.status).toBe(200)
        expect(
          await suggestCall.request?.headerValue(WARDROBE_GARMENT_SUBTYPE_HEADER)
        ).toBe('1')
        expect(
          suggestGarmentTagsResponseSchema.parse(suggestCall.responseJson).data
        ).toMatchObject({
          mode: 'suggested',
          garmentId: awaitingGarment.id,
          suggestions: { subtype: { value: 'tank', isConfident: true } },
        })
        const preview = dialog.getByRole('img', { name: 'Garment preview' })
        await expect(preview).toBeVisible()
        await expect(preview).toHaveJSProperty('complete', true)
        const displayed = await preview.evaluate((image: HTMLImageElement) => ({
          width: image.naturalWidth,
          url: image.currentSrc,
        }))
        expect(displayed.width).toBeGreaterThan(0)
        const asset = awaitingGarment.imageAccess
        expect(asset, 'the added piece has a private image').not.toBeNull()
        expect(new URL(displayed.url).pathname).toBe(new URL(asset!.url).pathname)
        await expect(
          dialog.getByRole('radio', { name: 'Top', exact: true })
        ).toBeChecked()
        await expect(dialog.getByTestId('garment-tagging-subtype-tank')).toBeChecked()
        await expect(
          dialog.getByRole('radio', { name: 'Cotton', exact: true })
        ).toBeChecked()
        await expect(
          dialog
            .getByRole('radiogroup', { name: 'Target Comfort Range' })
            .getByRole('radio', { name: /^Mild/ })
        ).toBeChecked()
        await expect(dialog.getByRole('button', { name: 'Looks right' })).toBeEnabled()
      })

      await test.step('Resolve an uncertain subtype before saving a keyboard override', async () => {
        const dialog = page.getByRole('dialog', { name: 'Organize Garment Tags' })
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        const suggested = createSuggestGarmentTagsWireFixture({
          garmentId: awaitingGarment.id,
        })
        const uncertainSuggestions = interceptNetworkCall({
          method: 'POST',
          url: suggestionUrl,
          fulfillResponse: {
            status: 200,
            body: {
              data: {
                ...suggested,
                suggestions: {
                  ...suggested.suggestions,
                  subtype: { value: 'tank', confidence: 0.25, isConfident: false },
                },
              },
            },
          },
        })
        await page.getByRole('button', { name: 'Needs tags' }).click()
        expect((await uncertainSuggestions).status).toBe(200)
        const confirm = dialog.getByRole('button', { name: 'Looks right' })
        await expect(dialog.getByText('Pick one', { exact: true })).toBeVisible()
        await expect(
          dialog
            .getByTestId('garment-tagging-subtype-picker')
            .getByRole('radio', { checked: true })
        ).toHaveCount(0)
        await expect(confirm).toBeDisabled()

        const categoryGroup = dialog.getByRole('radiogroup', {
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

        const subtypes = page.getByTestId('garment-tagging-subtype-picker')
        await expect(subtypes).toBeVisible()
        await expect(subtypes.getByTestId('garment-tagging-subtype-tank')).toHaveCount(0)
        await expect(confirm).toBeDisabled()
        await subtypes.getByTestId('garment-tagging-subtype-mini-skirt').click()

        await expect(confirm).toBeEnabled()
        const saved = interceptNetworkCall({
          method: 'PATCH',
          url: `**/api/v1/wardrobe/garments/${awaitingGarment.id}/tags`,
        })
        await confirm.click()
        const confirmation = await saved
        expect(confirmation.status).toBe(200)
        expect(confirmation.requestJson).toMatchObject({
          category: 'bottom',
          subtype: 'mini-skirt',
          material: 'cotton',
          comfortRange: 'mild',
        })
        await expect(
          page.getByRole('dialog', { name: 'Organize Garment Tags' })
        ).not.toBeVisible()
        await expect(
          page
            .getByTestId(`garment-card-${awaitingGarment.id}`)
            .getByTestId(`garment-open-${awaitingGarment.id}`)
        ).toBeEnabled()
      })

      await test.step('[7.19-CLOSET] Find the tagged subtype in Closet after a reload', async () => {
        const closetRead = interceptNetworkCall({
          method: 'GET',
          url: '**/api/v1/wardrobe/garments*',
        })
        await page.reload()
        expect((await closetRead).status).toBe(200)
        const openGarment = page.getByTestId(`garment-open-${awaitingGarment.id}`)
        await expect(openGarment).toBeEnabled()
        await expect(page.getByRole('button', { name: 'Needs tags' })).toHaveCount(0)
        await page.getByTestId('closet-category-bottom').click()
        await page.getByTestId('closet-subtype-mini-skirt').click()
        await openGarment.click()
        await expect(page.getByTestId('garment-detail-subtype')).toHaveText(/mini skirt/i)
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
