// Learning path Step 71: Today's outfit as a picture.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-71-todays-outfit-as-a-picture
import path from 'node:path'
import type { Page } from '@playwright/test'

const url = 'https://today-photo.example.test/top.png'
const photo = path.resolve(
  __dirname,
  '../../../apps/api/test/fixtures/garment-tagging/neutral-top.png'
)

export async function serveTodayPhoto(
  page: Page,
  { hold, fail }: { hold?: boolean; fail?: boolean } = {}
) {
  let markRequested!: () => void
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  if (!hold) release()
  await page.route(url, async (route) => {
    markRequested()
    await gate
    if (fail) await route.abort('failed')
    else await route.fulfill({ path: photo, contentType: 'image/png' })
  })
  return { url, requested, release }
}
