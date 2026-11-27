import { selectCommunityClimate } from '../support/helpers/community-ui'
import type { Locator, Page } from '@playwright/test'
import {
  createGarmentUploadUrlInputSchema,
  resolveCommunityTargetsResponseSchema,
  type CommunityFeedItem,
  type CommunityFeedMode,
  type CommunityFeedResponse,
  type ResolveCommunityTargetsInput,
} from '@couture/api-client/contracts/http'
import {
  createNotStartedOnboardingStateFixture,
  createReadyGarmentFixture,
} from '@couture/api-client/testing/wardrobe-fixtures'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { isNonLocalEnvironment } from '../support/helpers/api-test'
import { seedWebSession } from '../support/helpers/commerce-session'
import {
  COMMUNITY_ALLOCATE_PATH,
  COMMUNITY_PUBLISH_PATH,
  communityTest,
  deleteCommunityRowsForUser,
  signUpCommunityUser,
  waitForTerminalAuthorState,
} from '../support/helpers/community-session'
import { isAllowedGuestPreviewRequest } from '../support/helpers/guest-preview-requests'
import { localE2EAccessToken } from '../support/helpers/local-e2e-token'

const memberId = 'jade-capture-fixture'
const garment = createReadyGarmentFixture({ imageAccess: null })
const api = '**/api/v1'
const storagePath = '/storage/v1/object/upload/sign/wardrobe-images/jade-fixture'
const describeDraftPath = '/api/v1/community/posts/describe'
const phone = {
  authSessionEnabled: false,
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
}

type Background = 'plain' | 'detailed' | 'light-sleeves'

// Public signup does not need fixture service-role headers in request diagnostics.
const privateCommunityTest = communityTest.extend({
  trace: 'off',
  request: async ({ playwright }, use) => {
    const request = await playwright.request.newContext()
    try {
      await use(request)
    } finally {
      await request.dispose()
    }
  },
})

async function syntheticGarment(page: Page, background: Background) {
  const encoded = await page.evaluate((kind) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 384
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fafafa'
    ctx.fillRect(0, 0, 384, 384)
    if (kind === 'detailed') {
      // Four distinct corners average to gray. Both gray tiles must survive fallback.
      const shades = ['#282828', '#646464', '#9c9c9c', '#d8d8d8']
      for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 8; column++) {
          ctx.fillStyle = shades[(row * 2 + column) % shades.length]!
          ctx.fillRect(column * 48, row * 48, 48, 48)
        }
      }
      for (const [x, y, shade] of [
        [0, 0, shades[0]],
        [336, 0, shades[1]],
        [0, 336, shades[2]],
        [336, 336, shades[3]],
        [120, 24, '#808080'],
        [264, 312, '#808080'],
      ] as const) {
        ctx.fillStyle = shade!
        ctx.fillRect(x, y, 48, 48)
      }
    }
    if (kind === 'light-sleeves') {
      ctx.fillStyle = '#f5f5f5'
      ctx.fillRect(52, 96, 280, 72)
      ctx.fillStyle = '#19466a'
      ctx.fillRect(116, 96, 152, 192)
    } else {
      ctx.fillStyle = '#2277bb'
      ctx.fillRect(120, 96, 144, 192)
      ctx.fillRect(84, 96, 216, 72)
    }
    return canvas.toDataURL('image/png').split(',')[1]!
  }, background)
  return {
    name: `garment-${background}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(encoded, 'base64'),
  }
}

async function readImage(preview: Locator) {
  return preview.evaluate(async (image: HTMLImageElement) => {
    await image.decode()
    const canvas = document.createElement('canvas')
    const width = (canvas.width = image.naturalWidth)
    const height = (canvas.height = image.naturalHeight)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixel = (x: number, y: number) =>
      Array.from(
        context.getImageData(Math.floor(x * width), Math.floor(y * height), 1, 1).data
      )
    return {
      width,
      height,
      corner: pixel(0.05, 0.05),
      detail: pixel(0.375, 0.125),
      lowerDetail: pixel(0.75, 0.875),
      garment: pixel(0.5, 0.5),
      sleeve: pixel(0.79, 0.32),
      pixels: canvas.toDataURL(),
      filter: getComputedStyle(image).filter,
    }
  })
}

test.describe('Jade first use on a phone', () => {
  test.use(phone)

  test.beforeEach(({}, testInfo) => {
    test.skip(isNonLocalEnvironment(testInfo), 'Uses synthetic loopback-only fixtures.')
  })

  test('a guest explores style ideas and reopens an edited look after reload', async ({
    baseURL,
    page,
  }) => {
    const outsideGuestPreview: string[] = []
    const origin = new URL(baseURL!).origin
    page.on('request', (request) => {
      const method = request.method()
      const url = request.url()
      if (!isAllowedGuestPreviewRequest({ method, url }, origin)) {
        outsideGuestPreview.push(`${method} ${new URL(url).pathname}`)
      }
    })
    await page.goto('/preview')
    await page.getByTestId('guest-preview-birthdate').fill('2000-01-15')
    await page.getByTestId('guest-preview-gate-submit').click()

    const outfit = page.getByTestId('guest-preview-outfit')
    const nextLook = outfit.getByRole('button', { name: 'Try another look' })
    await expect(outfit.getByRole('heading', { name: 'School day' })).toBeVisible()
    await expect(
      page.getByText(
        'Sample looks and weather. Your closet and live weather stay separate.'
      )
    ).toBeVisible()
    await expect(outfit.getByText('Drawings of clothes')).toBeVisible()
    await nextLook.click()
    await expect(outfit.getByRole('heading', { name: 'Silk midi' })).toBeVisible()

    await page.getByText('Pick your style (optional)', { exact: true }).click()
    await page
      .getByRole('combobox', { name: 'Style', exact: true })
      .selectOption({ label: 'Cozy' })
    await page
      .getByRole('combobox', { name: 'Palette', exact: true })
      .selectOption({ value: 'colorful' })
    await page
      .getByRole('combobox', { name: 'Texture', exact: true })
      .selectOption({ value: 'textured' })
    const lookName = 'Mini skirt and tights'
    await expect(outfit.getByRole('heading', { name: lookName })).toBeVisible()
    await expect(outfit.getByText('Opaque tights', { exact: true })).toBeVisible()
    await expect(outfit.getByTestId('guest-preview-weather-chip')).toHaveText(
      'Mild and dry'
    )

    await outfit.getByRole('button', { name: 'Swap accessory: Opaque tights' }).click()
    await page.getByRole('dialog').getByRole('radio', { name: 'Ribbed socks' }).click()
    await expect(outfit.getByRole('heading', { name: 'Sample outfit' })).toBeVisible()
    await expect(outfit.getByText('Ribbed socks', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save example look' }).click()
    const saved = page.getByRole('region', { name: 'Saved on this device' })
    await expect(saved.getByRole('button', { name: lookName, exact: true })).toBeVisible()

    await nextLook.click()
    await expect(outfit.getByRole('heading', { name: lookName })).toHaveCount(0)
    await page
      .getByRole('group', { name: 'Sample weather' })
      .getByText('Cool and windy', { exact: true })
      .click()
    await expect(outfit.getByTestId('guest-preview-weather-chip')).toHaveText(
      'Cool and windy'
    )
    await page.reload()
    await saved.getByRole('button', { name: lookName, exact: true }).click()
    await expect(outfit.getByRole('heading', { name: 'Sample outfit' })).toBeVisible()
    await expect(outfit.getByText('Ribbed socks', { exact: true })).toBeVisible()
    await expect(outfit.getByTestId('guest-preview-weather-chip')).toHaveText(
      'Mild and dry'
    )
    await saved.getByRole('button', { name: `Remove ${lookName}` }).click()
    await page.reload()
    await expect(outfit).toBeVisible()
    await expect(saved).toHaveCount(0)
    expect(outsideGuestPreview, 'The sample flow stays local to the browser').toEqual([])
  })

  privateCommunityTest(
    'a sparse Community feed keeps the member look and labels example inspiration',
    async ({ communitySession, page, interceptNetworkCall }) => {
      const ownLook: CommunityFeedItem = {
        id: 'jade-own-look',
        title: 'My blue layers',
        caption: 'A blue outfit for a cool day.',
        altText: 'Illustration of blue layers.',
        climateBand: 'temperate_dry',
        status: 'published',
        challengeId: null,
        author: { isSelf: true, displayName: 'Fixture member' },
        publishedAt: '2026-11-21T12:00:00.000Z',
        createdAt: '2026-11-21T12:00:00.000Z',
        imageAccess: {
          url: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%201%201%22%3E%3Cpath%20d=%22M0%200h1v1H0z%22%20fill=%22blue%22/%3E%3C/svg%3E',
          expiresAt: '2099-12-31T00:00:00.000Z',
        },
      }
      void interceptNetworkCall({
        method: 'GET',
        url: `${api}/community/feed?*`,
        handler: async (route, request) => {
          expect(
            request.headers().authorization === `Bearer ${communitySession.accessToken}`,
            'the feed uses the disposable member session'
          ).toBe(true)
          const mode = new URL(request.url()).searchParams.get(
            'mode'
          ) as CommunityFeedMode
          await route.fulfill({
            json: {
              data: {
                items: mode === 'cold_wet' ? [] : [ownLook],
                authorStates: [],
                nextCursor: null,
                mode,
                viewerBand: 'temperate_dry',
                bandResolved: true,
                bandUnresolvedReason: null,
                experimentVariant: 'auto',
                activeChallenge: null,
              },
            } satisfies CommunityFeedResponse,
          })
        },
      })
      void interceptNetworkCall({
        method: 'GET',
        url: `${api}/community/spotlight?*`,
        fulfillResponse: {
          body: { data: { level: 'none', label: null, items: [], nextCursor: null } },
        },
      })
      void interceptNetworkCall({
        method: 'GET',
        url: `${api}/community/events?*`,
        fulfillResponse: {
          body: {
            data: {
              events: [],
              nextCursor: 'fixture',
              hasMore: false,
              resyncRequired: false,
            },
          },
        },
      })
      void interceptNetworkCall({
        method: 'POST',
        url: `${api}/community/targets/resolve`,
        handler: async (route, request) => {
          const { targets } = request.postDataJSON() as ResolveCommunityTargetsInput
          await route.fulfill({
            json: resolveCommunityTargetsResponseSchema.parse({
              data: {
                targets: targets.map(({ key }) => ({
                  key,
                  status: 'available',
                  communityRevision: '0',
                  post: {
                    ...ownLook,
                    reactions: {
                      counts: { applause: 0, love: 0, inspiration: 0 },
                      total: 0,
                      viewerReaction: null,
                      revision: 0,
                      generation: 0,
                    },
                  },
                  comment: null,
                  parent: null,
                  pageCursor: null,
                  parentPageCursor: null,
                  threadPosition: null,
                })),
              },
            }),
          })
        },
      })

      await page.goto('/community')
      const card = page.getByTestId(`lookbook-card-${ownLook.id}`)
      const rows = page.getByTestId('community-card-grid').getByTestId(/^lookbook-card-/)
      const examples = page.getByRole('region', { name: 'Look ideas' })
      await expect(card).toContainText(ownLook.title!)
      await expect(rows).toHaveCount(1)
      await expect(examples.getByText('Drawings of clothes')).toBeVisible()
      await expect(examples.getByText('Sample weather · Mild and dry')).toHaveCount(3)

      await selectCommunityClimate(page, 'cold_wet')
      await expect(card).toHaveCount(0)
      await expect(rows).toHaveCount(0)
      await expect(page.getByTestId('community-feed-empty')).toBeVisible()
      await expect(examples).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'See all climates' })).toBeVisible()

      await selectCommunityClimate(page, 'all')
      await expect(card).toBeVisible()
      await expect(rows).toHaveCount(1)
    }
  )

  for (const background of ['plain', 'detailed', 'light-sleeves'] as const) {
    test(`capture previews the uploaded crop with a ${background} background`, async ({
      page,
      baseURL,
      interceptNetworkCall,
    }, testInfo) => {
      // The UI runs its real encoder and signed PUT. The fixture server boundary captures
      // only synthetic bytes and responds without using a member account or persistent storage.
      const uploadUrl = new URL(storagePath, baseURL).href
      await seedWebSession(page, localE2EAccessToken(memberId))
      void interceptNetworkCall({
        method: 'GET',
        url: `${api}/user/profile`,
        fulfillResponse: {
          body: {
            user: {
              id: memberId,
              email: 'jade-capture@example.test',
              displayName: null,
              birthdate: null,
              role: 'guardian',
            },
            linkedGuardians: [],
            linkedTeens: [],
          },
        },
      })
      void interceptNetworkCall({
        method: 'GET',
        url: `${api}/wardrobe/onboarding`,
        fulfillResponse: { body: { data: createNotStartedOnboardingStateFixture() } },
      })
      void interceptNetworkCall({
        url: `${api}/wardrobe/garments`,
        handler: async (route, request) => {
          if (request.method() === 'GET') {
            await route.fulfill({ json: { data: [] } })
            return
          }
          await route.fulfill({ status: 201, json: { data: garment } })
        },
      })
      let allocations = 0
      void interceptNetworkCall({
        method: 'POST',
        url: `${api}/wardrobe/upload-url`,
        handler: async (route, request) => {
          allocations++
          const { mimeType } = createGarmentUploadUrlInputSchema.parse(
            request.postDataJSON()
          )
          await route.fulfill({
            status: 201,
            json: {
              data: {
                garmentId: garment.id,
                uploadSessionId: 'jade-fixture-session',
                uploadUrl,
                uploadToken: 'synthetic-upload-token',
                requiredHeaders: { 'content-type': mimeType },
                expiresAt: '2099-12-31T00:00:00.000Z',
              },
            },
          })
        },
      })
      let put: { bytes: Buffer | null; mimeType: string } | undefined
      void interceptNetworkCall({
        method: 'PUT',
        url: `**${storagePath}`,
        handler: async (route, request) => {
          put = {
            bytes: request.postDataBuffer(),
            mimeType: request.headers()['content-type'] ?? '',
          }
          await route.fulfill({ status: 200, json: { ok: true } })
        },
      })
      await page.goto('/wardrobe')
      await waitForAccessibilityReady(page)
      await page.getByRole('button', { name: '+ Add Garment' }).click()
      const dialog = page.getByRole('dialog')
      await dialog
        .getByLabel('Garment image file')
        .setInputFiles(await syntheticGarment(page, background))
      const preview = dialog.getByRole('img', { name: 'Garment preview' })
      const toggle = dialog.getByRole('switch', { name: 'Auto Background Cleanup' })
      const confirm = dialog.getByRole('button', { name: 'Use This Image' })
      await expect(preview).toBeVisible()

      if (background === 'plain') {
        // Wait for the asynchronous preview, then prove the user can move between both options.
        await expect(confirm).toBeEnabled()
        if (await toggle.isChecked()) await toggle.click()
        await expect.poll(async () => (await readImage(preview)).corner[3]).toBe(255)
        await toggle.click()
        await expect.soft
          .poll(async () => (await readImage(preview)).corner[3], {
            message:
              'The cleanup preview has transparent background pixels before upload',
            timeout: 4_000,
          })
          .toBe(0)
      }

      await expect(confirm).toBeEnabled()
      const beforeUpload = await readImage(preview)
      expect
        .soft(beforeUpload.filter, 'The crop preview has no CSS color filter')
        .toBe('none')
      expect(allocations, 'No upload allocation during editing').toBe(0)
      if (background !== 'plain') {
        await expect.soft(dialog.getByText(/background was kept/i)).toBeVisible()
      }
      await preview.screenshot({ path: testInfo.outputPath('preview.png') })

      const commit = interceptNetworkCall({
        method: 'POST',
        url: `${api}/wardrobe/garments`,
      })
      // Confirmation removes the preview. Decode the PUT using the same browser canvas.
      await confirm.click()
      await expect(dialog.getByText('Garment Upload Complete!')).toBeVisible()
      const { requestJson } = await commit
      expect(
        put?.bytes?.length,
        'The signed PUT carries actual image bytes'
      ).toBeGreaterThan(0)
      const uploadedDataUrl = `data:${put!.mimeType};base64,${put!.bytes!.toString('base64')}`
      const uploaded = await page
        .evaluate(async (src) => {
          const image = document.createElement('img')
          image.alt = 'Captured synthetic PUT'
          image.src = src
          image.hidden = true
          document.body.append(image)
          await image.decode()
        }, uploadedDataUrl)
        .then(() => readImage(page.getByAltText('Captured synthetic PUT')))
      const { pixels: visiblePixels, ...visibleSamples } = beforeUpload
      const { pixels: uploadedPixels, ...uploadedSamples } = uploaded
      await testInfo.attach('garment-preview-and-upload-samples', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            filter: beforeUpload.filter,
            preview: visibleSamples,
            upload: uploadedSamples,
            pixelsMatch: visiblePixels === uploadedPixels,
            commit: requestJson,
          },
          null,
          2
        ),
      })
      await testInfo.attach('uploaded-synthetic-garment', {
        contentType: put!.mimeType,
        body: put!.bytes!,
      })

      expect
        .soft(visiblePixels === uploadedPixels, 'Decoded preview and PUT pixels match')
        .toBe(true)
      if (background === 'plain') {
        expect(uploadedSamples.corner[3], 'The upload removes the plain background').toBe(
          0
        )
        expect(uploadedSamples.garment[3], 'The blue garment stays opaque').toBe(255)
        expect(uploadedSamples.garment[2]!).toBeGreaterThan(uploadedSamples.garment[0]!)
      } else if (background === 'light-sleeves') {
        for (const sample of [visibleSamples, uploadedSamples]) {
          expect.soft(sample.sleeve[3], 'The light sleeve stays opaque').toBe(255)
          expect.soft(sample.corner[3], 'The original pale corner stays opaque').toBe(255)
          expect.soft(sample.garment[3], 'The dark torso stays opaque').toBe(255)
        }
        expect.soft(requestJson).toMatchObject({ hasBgCleanup: false })
      } else {
        for (const sample of [visibleSamples, uploadedSamples]) {
          expect
            .soft(sample.detail[3], 'The gray background detail stays opaque')
            .toBe(255)
          expect
            .soft(sample.lowerDetail[3], 'The second gray detail stays opaque')
            .toBe(255)
          expect.soft(sample.corner[3], 'The detailed corner stays opaque').toBe(255)
          expect.soft(sample.garment[3], 'The blue garment stays opaque').toBe(255)
          expect
            .soft(sample.detail.slice(0, 3), 'The original gray remains')
            .toEqual([128, 128, 128])
          expect
            .soft(sample.lowerDetail.slice(0, 3), 'The second original gray remains')
            .toEqual([128, 128, 128])
        }
        expect.soft(requestJson).toMatchObject({ hasBgCleanup: false })
      }
    })
  }
})

privateCommunityTest.describe('Jade Community composer @local-lane', () => {
  privateCommunityTest.use(phone)

  privateCommunityTest(
    'an owned photo draft is optional, editable, and published through screening',
    async (
      { apiRequest, communitySession, interceptNetworkCall, page, recurse, request },
      testInfo
    ) => {
      await page.goto('/community')
      await page.getByTestId('create-post-button').click()
      const composer = page.getByRole('dialog')
      const caption = composer.getByTestId('post-caption-input')
      const suggest = composer.getByRole('button', {
        name: 'Suggest a description from photo',
      })
      const publish = composer.getByTestId('post-publish-submit')
      const allocation = interceptNetworkCall({
        method: 'POST',
        url: `**${COMMUNITY_ALLOCATE_PATH}`,
      })
      await composer
        .getByTestId('post-image-file-input')
        .setInputFiles(await syntheticGarment(page, 'plain'))
      const { postId, uploadSessionId } = (
        (await allocation).responseJson as {
          data: { postId: string; uploadSessionId: string }
        }
      ).data
      await expect(suggest).toBeEnabled()
      await expect(caption).toHaveValue('')
      await expect(publish).toBeDisabled()

      const description = interceptNetworkCall({
        method: 'POST',
        url: `**${describeDraftPath}`,
      })
      await suggest.click()
      const suggested = await description
      expect(suggested.status).toBe(200)
      expect(suggested.requestJson).toEqual({ postId, uploadSessionId })
      const { data: draft } = suggested.responseJson as { data: { caption: string } }
      expect(draft.caption).toMatch(/blue/i)
      await expect(caption).toHaveValue(draft.caption)
      await expect(publish).toBeDisabled()

      const otherUserId = await signUpCommunityUser(
        request,
        communitySession.apiBaseUrl,
        `jade-other-${testInfo.workerIndex}-${postId}`
      )
      try {
        const foreignDraft = await apiRequest({
          method: 'POST',
          baseUrl: communitySession.apiBaseUrl,
          path: describeDraftPath,
          headers: { Authorization: `Bearer ${localE2EAccessToken(otherUserId)}` },
          body: { postId, uploadSessionId },
        })
        expect(foreignDraft.status).toBe(404)
      } finally {
        await deleteCommunityRowsForUser(otherUserId)
      }

      const edited = 'Blue layers for a day out.'
      await caption.fill(edited)
      await composer.getByTestId('confirm-alt-text-checkbox').check()
      const publication = interceptNetworkCall({
        method: 'POST',
        url: `**${COMMUNITY_PUBLISH_PATH}`,
      })
      await publish.click()
      const published = await publication
      expect(published.status).toBe(200)
      expect(published.requestJson).toMatchObject({
        postId,
        uploadSessionId,
        caption: edited,
        altTextConfirmed: true,
      })
      const terminal = await waitForTerminalAuthorState(
        { apiRequest, recurse },
        {
          apiBaseUrl: communitySession.apiBaseUrl,
          userId: communitySession.userId,
          postId,
        }
      )
      expect(terminal.status).toBe('published')
      await page.reload()
      await page.getByTestId(`lookbook-open-${postId}`).click()
      await expect(page.getByTestId('community-detail-caption')).toHaveText(edited)
    }
  )

  privateCommunityTest(
    'a late or failed photo suggestion leaves manual writing available',
    async ({ communitySession, interceptNetworkCall, page }) => {
      // Activate the disposable member fixture for this browser context.
      expect(communitySession.userId).toBeTruthy()
      let releaseFirst!: () => void
      const holdFirst = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      let describeAttempts = 0
      await page.route(`**${describeDraftPath}`, async (route) => {
        if (++describeAttempts === 1) {
          await holdFirst
          await route.fulfill({ json: { data: { caption: 'Previous photo draft' } } })
          return
        }
        await route.abort('failed')
      })
      await page.goto('/community')
      await page.getByTestId('create-post-button').click()
      const composer = page.getByRole('dialog')
      const input = composer.getByTestId('post-image-file-input')
      const suggest = composer.getByRole('button', {
        name: 'Suggest a description from photo',
      })
      const caption = composer.getByTestId('post-caption-input')
      const replacement = await syntheticGarment(page, 'detailed')
      await input.setInputFiles(await syntheticGarment(page, 'plain'))
      const firstDescription = page.waitForRequest(`**${describeDraftPath}`)
      await suggest.click()
      try {
        const firstRequest = await firstDescription
        const cancellation = page.waitForEvent('requestfailed', {
          predicate: (request) => request === firstRequest,
        })
        await input.setInputFiles(replacement)
        expect((await cancellation).failure()?.errorText).toBe('net::ERR_ABORTED')
        await expect(suggest).toBeEnabled()
      } finally {
        releaseFirst()
      }
      await expect(caption).toHaveValue('')
      await suggest.click()
      await expect(
        composer.getByRole('status').filter({ hasText: 'You can still write your own' })
      ).toBeVisible()
      const manual = 'My caption for the replacement photo.'
      await caption.fill(manual)
      await composer.getByTestId('confirm-alt-text-checkbox').check()
      await expect(caption).toHaveValue(manual)
      const publication = interceptNetworkCall({
        method: 'POST',
        url: `**${COMMUNITY_PUBLISH_PATH}`,
      })
      await composer.getByTestId('post-publish-submit').click()
      const published = await publication
      expect(published.status).toBe(200)
      expect(published.requestJson).toMatchObject({
        caption: manual,
        altTextConfirmed: true,
      })
    }
  )
})
