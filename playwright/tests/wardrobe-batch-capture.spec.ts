// Learning path Step 85: Add several photos at once.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-85-add-several-photos-at-once
import path from 'node:path'
import {
  createGarmentItemInputSchema,
  garmentListResponseSchema,
  type GarmentListResponse,
} from '@couture/api-client/contracts/http'
import { expect } from '../support/fixtures/merged-fixtures'
import { isNonLocalEnvironment } from '../support/helpers/api-test'
import {
  signUpAndAuthenticate,
  wardrobeOnboardingEnvironment,
  wardrobeOnboardingTest as test,
} from '../support/helpers/wardrobe-onboarding-session'

const fixtureDir = path.resolve(
  __dirname,
  '../../apps/api/test/fixtures/garment-tagging/holdout-v1'
)
const retryPhoto = path.join(fixtureDir, 'green-pleated-skirt.jpg')
const photos = [
  path.join(fixtureDir, 'cream-crop.jpg'),
  retryPhoto,
  path.join(fixtureDir, 'red-ankle-boots.jpg'),
]

test.describe('Wardrobe batch capture @local-lane', () => {
  test.use({ authSessionEnabled: false })

  test('[P0] [7.28-E2E-001] saves the kept photos and retries a lost commit response exactly once', async ({
    apiRequest,
    cleanupState,
    interceptNetworkCall,
    page,
  }, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'Batch capture uses the supervised API, storage, and wardrobe worker.'
    )
    const accessToken = await signUpAndAuthenticate(
      apiRequest,
      page,
      cleanupState,
      testInfo,
      'wardrobe-batch-capture'
    )
    const readInventory = async () => {
      const response = await apiRequest({
        method: 'GET',
        path: '/api/v1/wardrobe/garments',
        baseUrl: wardrobeOnboardingEnvironment.apiBaseUrl,
        headers: { Authorization: `Bearer ${accessToken}` },
      }).validateSchema<GarmentListResponse>(garmentListResponseSchema)
      expect(response.status).toBe(200)
      return response.body.data
    }

    const allocations: (string | null)[] = []
    void interceptNetworkCall({
      method: 'POST',
      url: '**/api/v1/wardrobe/upload-url',
      handler: async (route, request) => {
        allocations.push(await request.headerValue('idempotency-key'))
        await route.continue()
      },
    })
    const commits: { garmentId: string; key: string | null; status: number }[] = []
    void interceptNetworkCall({
      method: 'POST',
      url: '**/api/v1/wardrobe/garments',
      handler: async (route, request) => {
        const { garmentId } = createGarmentItemInputSchema.parse(request.postDataJSON())
        const key = await request.headerValue('idempotency-key')
        const response = await route.fetch()
        commits.push({ garmentId, key, status: response.status() })
        if (commits.length === 2 && response.status() === 201) {
          // The server persisted the garment. Only the browser loses the answer.
          await route.abort('failed')
          return
        }
        await route.fulfill({ response })
      },
    })

    await page.goto('/wardrobe')
    await page.getByRole('button', { name: '+ Add Garment' }).click()
    const input = page.getByTestId('garment-batch-input')
    await expect(input).toHaveAttribute('multiple', '')
    const selectionPromise = page.waitForEvent('filechooser')
    await page.getByTestId('garment-batch-picker').click()
    await (await selectionPromise).setFiles(photos)

    for (const position of [1, 2, 3]) {
      const row = page.getByTestId(`garment-batch-row-${position}`)
      await expect(row.locator('img')).toBeVisible()
    }
    await page.getByTestId('garment-batch-keep-1').check()
    await page.getByTestId('garment-batch-keep-2').check()
    await expect(page.getByTestId('garment-batch-keep-3')).not.toBeChecked()
    expect(allocations).toHaveLength(0)
    expect(commits).toHaveLength(0)
    expect(await readInventory()).toEqual([])

    await page.getByRole('button', { name: 'Add 2 pieces', exact: true }).click()
    const retry = page.getByTestId('garment-batch-retry-2')
    const savedRow = page.getByTestId('garment-batch-row-1')
    const failedRow = page.getByTestId('garment-batch-row-2')
    await expect(savedRow.getByText('Saved', { exact: true })).toBeVisible()
    await expect(failedRow.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(retry).toBeVisible()
    await expect(savedRow.getByTestId('garment-batch-retry-1')).toHaveCount(0)
    await expect(failedRow.locator('img')).toHaveCount(0)
    expect(commits.map(({ status }) => status)).toEqual([201, 201])
    const first = commits[0]!
    const second = commits[1]!
    expect(first.garmentId).not.toBe(second.garmentId)
    expect(first.key).toBeTruthy()
    expect(second.key).toBeTruthy()
    expect(first.key).not.toBe(second.key)

    const chooserPromise = page.waitForEvent('filechooser')
    await retry.click()
    await (await chooserPromise).setFiles(retryPhoto)
    await expect(failedRow.getByText('Saved', { exact: true })).toBeVisible()
    await expect(retry).toHaveCount(0)

    expect(commits).toEqual([first, second, { ...second, status: 200 }])
    expect(allocations).toHaveLength(2)
    expect(new Set(allocations).size).toBe(2)
    await page.getByTestId('garment-batch-done').click()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Closet', level: 1 })).toBeVisible()
    const inventory = await readInventory()
    expect(inventory.map(({ id }) => id).sort()).toEqual(
      [first.garmentId, second.garmentId].sort()
    )
    expect(inventory.every(({ committedAt }) => committedAt !== null)).toBe(true)
  })
})
