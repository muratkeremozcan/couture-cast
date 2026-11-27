// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 58: Image uploads straight to storage.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#image-uploads-straight-to-storage
// Story 4.4 AC 2 and AC 3: the "My Form" photo upload path, reached from the
// standalone silhouette settings surface (decision 3, reachable outside
// onboarding).
//
// This runs against the real default `HeuristicSilhouettePhotoModerationEngine`
// (decisions 8-9). `wardrobe-silhouette-image-validation.ts` decodes real image
// bytes before any moderation engine runs, so a genuine browser upload cannot use
// the `FIXTURE:<outcome>:` marker convention the API's integration tests rely on;
// that marker is not a decodable image. The two committed fixture PNGs
// (`playwright/fixtures/wardrobe/silhouette-photo-*.png`) are engineered so the real
// heuristic's border-vs-center contrast measurement lands on a known verdict: a
// solid single-colour photo always measures zero contrast distance (`contrast`), and
// a two-tone photo with a clearly different, non-skin-toned center region always
// clears both thresholds (`ready`). The story's Dev Notes carry the pixel geometry.
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { createNetworkErrorMonitorFixture } from '@seontechnologies/playwright-utils/network-error-monitor/fixtures'
import { expect } from '../support/fixtures/merged-fixtures'
import {
  classifyGuardedErrors,
  guardExpectedError,
} from '../support/helpers/expected-error-guard'
import { waitForAccessibilityReady } from '../support/helpers/accessibility'
import { isNonLocalEnvironment } from '../support/helpers/api-test'
import { writePhonePhoto } from '../support/helpers/phone-camera-photo'
import {
  VERCEL_FUNCTION_MAX_BODY_BYTES,
  vercelFunctionBodyLimit,
  watchPuts,
} from '../support/helpers/vercel-function-body-limit'
import { expectSignedStorageUpload } from '../support/helpers/storage-upload-url'
import {
  signUpAndAuthenticate,
  wardrobeOnboardingTest as myFormTest,
} from '../support/helpers/wardrobe-onboarding-session'

const test = myFormTest
const readyFixturePath = path.resolve(
  __dirname,
  '../fixtures/wardrobe/silhouette-photo-ready.png'
)
const contrastFixturePath = path.resolve(
  __dirname,
  '../fixtures/wardrobe/silhouette-photo-contrast.png'
)

/**
 * Opens the standalone Silhouette settings from the Closet (decision 3). Story CC-7.11 D5, D6:
 * the modal became the `/wardrobe/silhouette` route, reached from the Closet top bar More menu,
 * so this returns the route's main column, where the loaded panel renders.
 */
async function openSilhouetteSettings(page: Page): Promise<Locator> {
  await page.goto('/wardrobe')
  await waitForAccessibilityReady(page)
  await page.getByTestId('app-header').getByTestId('closet-more-menu').click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Silhouette' }).click()
  await expect(page).toHaveURL('/wardrobe/silhouette')
  const screen = page.locator('main#main-content')
  await expect(screen.getByTestId('silhouette-settings-panel')).toBeVisible()
  return screen
}

const MY_FORM_COMMIT_URL = /\/api\/v1\/wardrobe\/silhouette\/my-form\/commit(\?|$)/

/**
 * For a retry whose first commit answers 409 UPLOAD_BYTES_MISSING by design. The network-error
 * monitor takes URL patterns only, so it stands aside for the My Form commit URL alone. A
 * companion guard covers that URL for the whole test on every page and method, and requires
 * exactly one POST 409 UPLOAD_BYTES_MISSING there and no other error. The test still pins the
 * commit sequence.
 */
const myFormRetryTest = myFormTest
  .extend(createNetworkErrorMonitorFixture({ excludePatterns: [MY_FORM_COMMIT_URL] }))
  .extend<{ myFormCommitGuard: void }>({
    myFormCommitGuard: [
      async ({ context }, use, testInfo) => {
        const guard = guardExpectedError(context, MY_FORM_COMMIT_URL)
        await use()
        // A skipped test (the non-local skip runs after this auto fixture starts) never commits.
        if (testInfo.status === 'skipped') return
        // Exactly the one designed 409 across the context, and no other error on the URL.
        expect(
          classifyGuardedErrors(await guard.settle(), {
            method: 'POST',
            status: 409,
            code: 'UPLOAD_BYTES_MISSING',
          }),
          'errors on the My Form commit URL'
        ).toEqual({ allowedCount: 1, unexpected: [] })
      },
      { auto: true },
    ],
  })

/** Every My Form upload URL the API hands out, in order. */
function watchMyFormAllocations(page: Page): Promise<string>[] {
  const allocated: Promise<string>[] = []
  page.on('response', (response) => {
    const request = response.request()
    if (request.method() !== 'POST' || !request.url().includes('/my-form/upload-url'))
      return
    if (!response.ok()) return
    allocated.push(
      response.json().then((body: { data: { uploadUrl: string } }) => body.data.uploadUrl)
    )
  })
  return allocated
}

/** Every My Form commit answer, in order: status and the error code when there is one. */
function watchMyFormCommits(page: Page): Promise<{ status: number; code?: string }>[] {
  const outcomes: Promise<{ status: number; code?: string }>[] = []
  page.on('response', (response) => {
    const request = response.request()
    if (request.method() !== 'POST' || !request.url().includes('/my-form/commit')) return
    outcomes.push(
      response
        .json()
        .catch(() => null)
        .then((body: { message?: unknown } | null) => ({
          status: response.status(),
          ...(response.status() >= 400 && typeof body?.message === 'string'
            ? { code: body.message }
            : {}),
        }))
    )
  })
  return outcomes
}

const BASEWEAR_CONFIRM_LABEL = /I'm wearing plain white or black clothing/

async function confirmBasewearGuidance(silhouette: Locator) {
  await silhouette.getByLabel(BASEWEAR_CONFIRM_LABEL).check()
}

myFormTest.describe('Wardrobe Silhouette "My Form" Upload', () => {
  myFormTest.use({ authSessionEnabled: false })

  myFormTest.beforeEach(({}, testInfo) => {
    test.skip(
      isNonLocalEnvironment(testInfo),
      'The "My Form" journey requires the supervised local API and wardrobe worker.'
    )
  })

  myFormTest(
    '[P0] [4.4-E2E-003] uploads a "My Form" photo through to ready, it becomes the active silhouette mode, and adjusting a slider switches back',
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-ready'
      )
      const silhouette = await openSilhouetteSettings(page)

      await test.step('Confirm the basewear guidance and upload a photo', async () => {
        await confirmBasewearGuidance(silhouette)
        await silhouette
          .getByRole('button', { name: 'Upload a full-body photo', exact: true })
          .click()
        await silhouette.getByLabel('My Form photo file').setInputFiles(readyFixturePath)
        // The transient "Processing your photo…" state is not asserted: the real
        // worker can settle before Playwright observes it, since a tiny synthetic
        // fixture image processes in single-digit milliseconds. The terminal ready
        // state below is the claim.
      })

      await test.step('The photo reaches ready and becomes the active silhouette mode', async () => {
        await expect(silhouette.getByText('My Form photo ready')).toBeVisible({
          timeout: 20_000,
        })
        await expect(silhouette.getByText('My Form photo', { exact: true })).toBeVisible()
        await expect(silhouette.getByAltText('My Form')).toBeVisible()
        await expect(
          silhouette.getByRole('button', { name: 'Remove photo' })
        ).toBeVisible()
      })

      await test.step('Adjusting a slider switches the active mode back to the default mannequin (AC 2)', async () => {
        const heightSlider = silhouette.getByTestId('silhouette-height-slider')
        const saveResponse = interceptNetworkCall({
          method: 'PUT',
          url: '**/api/v1/wardrobe/silhouette*',
        })
        await heightSlider.focus()
        await heightSlider.press('ArrowRight')
        await saveResponse
        await expect(silhouette.getByText('Adjustable silhouette')).toBeVisible()
      })
    }
  )

  myFormTest(
    '[P1] [4.4-E2E-004] surfaces the contrast failure reason with no retry action, and recovers by choosing a different photo',
    async ({ apiRequest, cleanupState, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-contrast'
      )
      const silhouette = await openSilhouetteSettings(page)

      await confirmBasewearGuidance(silhouette)
      await silhouette
        .getByRole('button', { name: 'Upload a full-body photo', exact: true })
        .click()
      await silhouette.getByLabel('My Form photo file').setInputFiles(contrastFixturePath)

      await test.step('The contrast-specific error appears with no retry action', async () => {
        await expect(
          silhouette.getByText(
            /We couldn't separate you from the background clearly\. Retake the photo with plainer clothing or a plainer background\./
          )
        ).toBeVisible({ timeout: 20_000 })
        await expect(
          silhouette.getByRole('button', { name: 'Retry upload' })
        ).toHaveCount(0)
      })

      await test.step('Choosing a different photo recovers and reaches ready', async () => {
        await expect(
          silhouette.getByRole('button', {
            name: 'Upload a full-body photo',
            exact: true,
          })
        ).toBeVisible()
        await silhouette
          .getByRole('button', { name: 'Upload a full-body photo', exact: true })
          .click()
        await silhouette.getByLabel('My Form photo file').setInputFiles(readyFixturePath)
        await expect(silhouette.getByText('My Form photo ready')).toBeVisible({
          timeout: 20_000,
        })
      })
    }
  )

  myFormRetryTest(
    '[P1] [4.4-E2E-005] retries after a transient network failure, reusing the same upload attempt',
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-retry'
      )
      const silhouette = await openSilhouetteSettings(page)

      await test.step('Fail the raw-bytes PUT exactly once, simulating a transient network drop', () => {
        let abortedOnce = false
        void interceptNetworkCall({
          url: '**/*',
          handler: async (route, request) => {
            if (!abortedOnce && request.method() === 'PUT') {
              abortedOnce = true
              await route.abort('failed')
              return
            }
            await route.continue()
          },
        })
      })

      // The retry must continue the same upload attempt: every upload-url allocation (the client
      // may keep its open allocation or replay it) carries one idempotency key. The dropped PUT
      // never reached storage, so the retry's commit finds no bytes, and the client puts them
      // again at the same staged object before committing for good.
      const allocationIdempotencyKeys: string[] = []
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().includes('/my-form/upload-url')
        ) {
          const key = request.headers()['idempotency-key']
          if (key) allocationIdempotencyKeys.push(key)
        }
      })
      const allocations = watchMyFormAllocations(page)
      // Every PUT to any host, so bytes sent anywhere but the staged object fail the test.
      const puts = watchPuts(page)

      const commits = watchMyFormCommits(page)

      await confirmBasewearGuidance(silhouette)
      await silhouette
        .getByRole('button', { name: 'Upload a full-body photo', exact: true })
        .click()
      await silhouette.getByLabel('My Form photo file').setInputFiles(readyFixturePath)

      await test.step('An inline error with a Retry action appears', async () => {
        const retryButton = silhouette.getByRole('button', { name: 'Retry upload' })
        await expect(retryButton).toBeVisible({ timeout: 20_000 })
      })

      await test.step('Retrying reuses the same attempt and reaches ready', async () => {
        await silhouette.getByRole('button', { name: 'Retry upload' }).click()
        await expect(silhouette.getByText('My Form photo ready')).toBeVisible({
          timeout: 20_000,
        })
      })

      await test.step('The retry continued the original attempt, not a fresh one', async () => {
        expect(allocationIdempotencyKeys.length).toBeGreaterThanOrEqual(1)
        expect(new Set(allocationIdempotencyKeys).size).toBe(1)
        // Two attempts at one authorized staged object on the configured storage host; a
        // replayed allocation may sign it afresh, so the object path is compared, not the token.
        const allocatedUrls = await Promise.all(allocations)
        const stagedObjects = allocatedUrls.map(
          (url) => expectSignedStorageUpload(url).pathname
        )
        expect(new Set(stagedObjects).size).toBe(1)
        expect(puts).toHaveLength(2)
        for (const put of puts) {
          // The full URL, token included, is one the API handed out, the aborted first PUT too.
          expect(allocatedUrls).toContain(put)
          expect(expectSignedStorageUpload(put).pathname).toBe(stagedObjects[0])
        }
        expect(await Promise.all(commits)).toEqual([
          { status: 409, code: 'UPLOAD_BYTES_MISSING' },
          { status: 201 },
        ])
      })
    }
  )

  // Production follow-up 2026-11-19 (round 4): when the bytes reach storage but the response
  // never reaches the phone, Retry keeps the open attempt and commits first. The stored bytes
  // commit; the photo is not uploaded a second time.
  myFormTest(
    '[P1] [4.4-E2E-007] retries after a lost upload response by committing the stored bytes, without a second upload',
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-lost-response'
      )
      const silhouette = await openSilhouetteSettings(page)

      await test.step('Let the first byte PUT reach storage, then drop its response', () => {
        let droppedOnce = false
        void interceptNetworkCall({
          method: 'PUT',
          url: '**/storage/v1/object/upload/sign/**',
          handler: async (route) => {
            if (!droppedOnce) {
              droppedOnce = true
              const stored = await route.fetch()
              expect(stored.status()).toBe(200)
              await route.abort('failed')
              return
            }
            await route.continue()
          },
        })
      })
      const allocations = watchMyFormAllocations(page)
      // Every PUT to any host, so a second upload anywhere fails the test.
      const puts = watchPuts(page)
      const commits = watchMyFormCommits(page)

      await confirmBasewearGuidance(silhouette)
      await silhouette
        .getByRole('button', { name: 'Upload a full-body photo', exact: true })
        .click()
      await silhouette.getByLabel('My Form photo file').setInputFiles(readyFixturePath)

      await test.step('The dropped response surfaces a Retry action', async () => {
        await expect(
          silhouette.getByRole('button', { name: 'Retry upload' })
        ).toBeVisible({
          timeout: 20_000,
        })
      })

      await test.step('Retrying commits the stored bytes and reaches ready', async () => {
        await silhouette.getByRole('button', { name: 'Retry upload' }).click()
        await expect(silhouette.getByText('My Form photo ready')).toBeVisible({
          timeout: 20_000,
        })
      })

      await test.step('One upload, one commit', async () => {
        const allocated = await Promise.all(allocations)
        expect(allocated).toHaveLength(1)
        expectSignedStorageUpload(allocated[0]!)
        expect(puts).toEqual([allocated[0]])
        expect(await Promise.all(commits)).toEqual([{ status: 201 }])
      })
    }
  )

  // Production follow-up 2026-11-19: upload bytes went through a Vercel Function, which refuses
  // a body over about 4.5 MB before the API sees it. A full-body phone photo saved as PNG is
  // over that, so production refuses it while the uncapped local API passes it.
  myFormTest(
    '[P0] [4.4-E2E-006] uploads a phone-size PNG My Form photo larger than a function body can carry',
    async ({ apiRequest, cleanupState, interceptNetworkCall, page }, testInfo) => {
      const photoPath = testInfo.outputPath('my-form-phone-photo.png')
      const photoBytes = await writePhonePhoto(photoPath, {
        width: 1536,
        height: 2048,
        format: 'png',
        subjectPath: readyFixturePath,
      })
      // The picker takes it (10 MiB cap), and a function body cannot carry it.
      expect(photoBytes).toBeGreaterThan(VERCEL_FUNCTION_MAX_BODY_BYTES)
      expect(photoBytes).toBeLessThan(10 * 1024 * 1024)

      void interceptNetworkCall({
        method: 'PUT',
        url: '**/api/v1/**',
        handler: vercelFunctionBodyLimit(),
      })
      const allocation = interceptNetworkCall({
        method: 'POST',
        url: '**/api/v1/wardrobe/silhouette/my-form/upload-url',
      })
      const uploads = watchPuts(page)

      await signUpAndAuthenticate(
        apiRequest,
        page,
        cleanupState,
        testInfo,
        'wardrobe-my-form-large'
      )
      const silhouette = await openSilhouetteSettings(page)
      await confirmBasewearGuidance(silhouette)
      await silhouette
        .getByRole('button', { name: 'Upload a full-body photo', exact: true })
        .click()
      await silhouette.getByLabel('My Form photo file').setInputFiles(photoPath)

      await expect(silhouette.getByText('My Form photo ready')).toBeVisible({
        timeout: 30_000,
      })
      // The photo went to the signed storage URL and nowhere else.
      const { responseJson } = await allocation
      const { uploadUrl } = (responseJson as { data: { uploadUrl: string } }).data
      expectSignedStorageUpload(uploadUrl)
      expect(uploads).toEqual([uploadUrl])
    }
  )
})
