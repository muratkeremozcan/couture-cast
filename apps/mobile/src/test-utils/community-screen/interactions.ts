import type { CommunityFeedMode } from '@couture/api-client/contracts/http'
import { screen, within } from '@testing-library/react'
import i18n from '@/src/lib/i18n'
import { press } from '@/src/test-utils/press'
import { communityGateOpen } from './harness'

export async function openCommunityClimate() {
  press(await screen.findByTestId('community-climate-filter'))
  return within(await screen.findByTestId('community-climate-sheet'))
}

export async function selectCommunityClimate(mode: CommunityFeedMode) {
  const sheet = await openCommunityClimate()
  press(sheet.getByTestId(`community-filter-chip-${mode}`))
}

export function closeCommunityClimate() {
  press(screen.getByRole('button', { name: i18n.t('shell.close') }))
}

export async function openCommunityCardActions(postId: string) {
  await communityGateOpen()
  const card = await screen.findByTestId(`community-post-card-${postId}`)
  press(within(card).getByTestId('community-card-actions'))
}

export async function openCommunityPostComments(postId: string) {
  press(await screen.findByTestId(`community-card-open-${postId}`))
  const detail = await screen.findByTestId('community-post-detail')
  press(await within(detail).findByTestId(`community-card-comments-${postId}`))
}
