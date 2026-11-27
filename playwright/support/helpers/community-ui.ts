// Learning path Step 72: Calm Community with an empty state.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-72-calm-community-with-an-empty-state
import type { Page } from '@playwright/test'
import type { CommunityFeedMode } from '@couture/api-client/contracts/http'

export async function openCommunityClimate(page: Page) {
  await page.getByTestId('community-climate-filter').click()
  return page.getByTestId('community-climate-sheet')
}

export async function selectCommunityClimate(page: Page, mode: CommunityFeedMode) {
  const sheet = await openCommunityClimate(page)
  await sheet.getByTestId(`community-filter-${mode}`).click()
}
