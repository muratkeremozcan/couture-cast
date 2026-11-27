import type { CommunityFeedMode } from '@couture/api-client/contracts/http'
import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'

export async function openCommunityClimate(user: UserEvent) {
  await user.click(await screen.findByTestId('community-climate-filter'))
  return within(await screen.findByTestId('community-climate-sheet'))
}

export async function selectCommunityClimate(user: UserEvent, mode: CommunityFeedMode) {
  const sheet = await openCommunityClimate(user)
  await user.click(sheet.getByTestId(`community-filter-${mode}`))
}

export async function openCommunityCardActions(
  user: UserEvent,
  postId: string,
  scope = ''
) {
  const card = await screen.findByTestId(`${scope}lookbook-card-${postId}`)
  await user.click(within(card).getByTestId('community-card-actions'))
  return within(card)
}
