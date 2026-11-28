// Learning path Step 86: Several garments from one flat-lay photo.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-86-several-garments-from-one-flat-lay-photo
import type { Page } from '@playwright/test'
import {
  flatLayConfirmResponseSchema,
  flatLayReviewResponseSchema,
  garmentItemSchema,
  type GarmentCategory,
} from '@couture/api-client/contracts/http'
import sharp from 'sharp'
import { expect } from '../support/fixtures/merged-fixtures'
import { isNonLocalEnvironment } from '../support/helpers/api-test'
import {
  signUpAndAuthenticate,
  wardrobeOnboardingTest as test,
} from '../support/helpers/wardrobe-onboarding-session'

const reviewUrl = '**/api/v1/wardrobe/flat-lay/review'
const confirmUrl = '**/api/v1/wardrobe/flat-lay/confirm'
const reviewLifetimeMs = 15 * 60_000

async function mask(background: string) {
  return (
    await sharp({ create: { width: 32, height: 32, channels: 4, background } })
      .webp()
      .toBuffer()
  ).toString('base64')
}

async function reviewResponse() {
  const [top, bottom, shoes] = await Promise.all([
    mask('#ac3f52'),
    mask('#333c83'),
    mask('#327f51'),
  ])
  return flatLayReviewResponseSchema.parse({
    expiresAt: new Date(Date.now() + reviewLifetimeMs).toISOString(),
    items: [
      {
        id: '08c5bf9a-ad71-4cce-ae9e-2fb79db59051',
        mask: top,
        token: 'top-mask-token',
        category: 'top',
      },
      {
        id: '98bb78fe-58b3-447b-83d4-84507fbab462',
        mask: bottom,
        token: 'bottom-mask-token',
        category: 'bottom',
      },
      {
        id: '11ac09ab-0011-4d1a-bc3a-9595f07781cb',
        mask: shoes,
        token: 'shoes-mask-token',
        category: 'shoes',
      },
    ],
  })
}

async function pickFlatLay(page: Page) {
  const source = await sharp({
    create: { width: 256, height: 256, channels: 3, background: '#f2eee5' },
  })
    .jpeg()
    .toBuffer()
  await page.getByRole('button', { name: '+ Add Garment' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add from flat-lay photo', exact: true }).click()
  const picker = await chooser
  expect(picker.isMultiple()).toBe(false)
  await picker.setFiles({ name: 'flat-lay.jpg', mimeType: 'image/jpeg', buffer: source })
}

function savedGarment(id: string, category: GarmentCategory, instant: string) {
  return garmentItemSchema.parse({
    id,
    status: 'ready',
    category,
    material: null,
    comfortRange: null,
    tagsConfirmedAt: instant,
    fileSizeBytes: 512,
    mimeType: 'image/webp',
    retentionStatus: 'active',
    createdAt: instant,
    committedAt: instant,
    imageAccess: null,
  })
}

test.describe('Wardrobe flat-lay capture @local-lane', () => {
  test.use({ authSessionEnabled: false })

  test('[P0] [7.29-REVIEW] edits and removes pieces and retries the same confirmation', async ({
    apiRequest,
    cleanupState,
    interceptNetworkCall,
    page,
  }, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), 'Flat-lay capture uses a local member.')
    await signUpAndAuthenticate(
      apiRequest,
      page,
      cleanupState,
      testInfo,
      'flat-lay-review'
    )

    const review = await reviewResponse()
    const reviewCall = interceptNetworkCall({
      method: 'POST',
      url: reviewUrl,
      fulfillResponse: { status: 200, body: review },
    })
    const submissions: unknown[] = []
    const savedAt = new Date().toISOString()
    void interceptNetworkCall({
      method: 'POST',
      url: confirmUrl,
      handler: async (route, request) => {
        submissions.push(request.postDataJSON())
        if (submissions.length === 1) {
          await route.abort('failed')
          return
        }
        await route.fulfill({
          json: flatLayConfirmResponseSchema.parse({
            garments: [
              savedGarment(review.items[0]!.id, 'outerwear', savedAt),
              savedGarment(review.items[2]!.id, 'shoes', savedAt),
            ],
          }),
        })
      },
    })

    await page.goto('/wardrobe')
    await pickFlatLay(page)
    const { request } = await reviewCall
    expect(await request?.headerValue('content-type')).toContain('multipart/form-data')
    expect(request?.postDataBuffer()?.includes('name="photo"; filename="photo"')).toBe(
      true
    )
    expect(request?.postDataBuffer()?.includes('flat-lay.jpg')).toBe(false)

    const dialog = page.getByRole('dialog', { name: 'Review pieces' })
    const previews = dialog.locator('img')
    await expect(previews).toHaveCount(3)
    for (const index of [0, 1, 2]) {
      await expect(previews.nth(index)).toBeVisible()
      await expect(previews.nth(index)).toHaveJSProperty('naturalWidth', 32)
    }
    const sources = await previews.evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).src)
    )
    expect(new Set(sources).size).toBe(3)
    await expect(
      dialog.getByRole('button', { name: 'Add 3 pieces', exact: true })
    ).toBeEnabled()
    await expect(
      dialog.getByRole('button', { name: 'Edit tags', exact: true })
    ).toHaveCount(3)
    await expect(dialog.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(
      3
    )
    expect(submissions).toEqual([])

    const editFirst = dialog
      .getByRole('button', { name: 'Edit tags', exact: true })
      .first()
    await editFirst.click()
    const category = dialog.getByRole('combobox', { name: 'Category', exact: true })
    await expect(category).toBeFocused()
    await category.selectOption('outerwear')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(editFirst).toBeFocused()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).nth(1).click()
    await expect(previews).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Add 2 pieces', exact: true }).click()
    const retry = dialog.getByRole('button', { name: 'Try again', exact: true })
    await expect(retry).toBeVisible()
    expect(submissions).toHaveLength(1)
    expect(submissions[0]).toEqual({
      items: [
        {
          id: review.items[0]!.id,
          mask: review.items[0]!.mask,
          token: review.items[0]!.token,
          tags: expect.objectContaining({ category: 'outerwear' }),
        },
        {
          id: review.items[2]!.id,
          mask: review.items[2]!.mask,
          token: review.items[2]!.token,
          tags: expect.objectContaining({ category: 'shoes' }),
        },
      ],
    })

    await retry.click()
    await expect(dialog).toHaveCount(0)
    expect(submissions).toEqual([submissions[0], submissions[0]])
  })

  test('[P0] [7.29-PURGE] clears previews after cancel and expiry', async ({
    apiRequest,
    cleanupState,
    interceptNetworkCall,
    page,
  }, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), 'Flat-lay capture uses a local member.')
    await signUpAndAuthenticate(
      apiRequest,
      page,
      cleanupState,
      testInfo,
      'flat-lay-purge'
    )

    const review = await reviewResponse()
    void interceptNetworkCall({
      method: 'POST',
      url: reviewUrl,
      fulfillResponse: { status: 200, body: review },
    })
    const confirmations: unknown[] = []
    void interceptNetworkCall({
      method: 'POST',
      url: confirmUrl,
      handler: async (route, request) => {
        confirmations.push(request.postDataJSON())
        await route.abort('failed')
      },
    })

    await page.clock.install()
    await page.goto('/wardrobe')
    await pickFlatLay(page)
    const dialog = page.getByRole('dialog', { name: 'Review pieces' })
    const previews = dialog.locator('img')
    await expect(previews).toHaveCount(3)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await pickFlatLay(page)
    await expect(previews).toHaveCount(3)
    await page.clock.fastForward(reviewLifetimeMs + 1)
    const source = page.getByRole('dialog', { name: 'Add a piece', exact: true })
    await expect(source).toBeVisible()
    await expect(source.locator('img')).toHaveCount(0)
    await expect(
      source.getByRole('button', { name: 'Add 3 pieces', exact: true })
    ).toHaveCount(0)
    await expect(
      source.getByText('This review expired. Choose the photo again.')
    ).toBeVisible()
    expect(confirmations).toEqual([])
  })
})
