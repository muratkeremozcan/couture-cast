import {
  editCommunityPostTextResponseSchema,
  publishCommunityPostResponseSchema,
} from '@couture/api-client/contracts/http'
import {
  COMMUNITY_PUBLISH_PATH,
  communityTest as test,
  completedCommunityFeed,
  expect,
  loadCommunityFixture,
  waitForTerminalAuthorState,
} from '../support/helpers/community-session'

test.use({ authSessionEnabled: false, viewport: { width: 390, height: 844 } })

test(
  '[P0] Community shows a published title and retains the owner draft when saving fails @local-lane',
  { annotation: [{ type: 'skipNetworkMonitoring' }] },
  async ({ apiRequest, communitySession, interceptNetworkCall, page, recurse }) => {
    const fixture = loadCommunityFixture('safe-satin-plum-512x512.jpg')
    const original = { title: 'Plum layers', caption: 'Layers for a cool evening' }
    const updated = {
      title: 'Plum layers for autumn',
      caption: 'A wrap dress and light jacket',
    }
    await page.goto('/community')
    await page.getByTestId('create-post-button').click()
    await page.getByTestId('post-image-file-input').setInputFiles({
      name: fixture.path,
      mimeType: fixture.contentType,
      buffer: fixture.bytes,
    })
    const altText = page.getByTestId('post-alt-text-input')
    await expect(altText).not.toHaveValue('')
    await altText.fill('A plum satin wrap dress.')
    await page.getByTestId('confirm-alt-text-checkbox').check()
    const title = page.getByTestId('post-title-input')
    const description = page.getByTestId('post-caption-input')
    await title.fill(original.title)
    await title.press('Tab')
    await expect(description).toBeFocused()
    await description.fill(original.caption)

    const publish = interceptNetworkCall({
      method: 'POST',
      url: `**${COMMUNITY_PUBLISH_PATH}`,
    })
    await page.getByTestId('post-publish-submit').click()
    const published = await publish
    expect(published.status).toBe(200)
    expect(published.requestJson).toMatchObject(original)
    const { id: postId } = publishCommunityPostResponseSchema.parse(
      published.responseJson
    ).data
    const decision = await waitForTerminalAuthorState(
      { apiRequest, recurse },
      {
        apiBaseUrl: communitySession.apiBaseUrl,
        userId: communitySession.userId,
        postId,
      }
    )
    expect(decision.status).toBe('published')

    await page.reload()
    const initialFeed = completedCommunityFeed(page, 'all')
    await page.getByRole('button', { name: 'Every climate', exact: true }).click()
    expect((await initialFeed).status).toBe(200)
    const card = page.getByTestId(`lookbook-card-${postId}`)
    await expect(card.getByTestId(`title-${postId}`)).toHaveText(original.title)
    await expect(card.getByTestId(`caption-${postId}`)).toHaveText(original.caption)
    await card.getByTestId(`lookbook-open-${postId}`).click()

    const detail = page.getByRole('dialog')
    await expect(detail).toHaveAccessibleName(original.title)
    const edit = detail.getByTestId('community-edit-text')
    const editTitle = detail.getByTestId('community-edit-title')
    const editDescription = detail.getByTestId('community-edit-description')
    await edit.click()
    await expect(editTitle).toBeFocused()
    await editTitle.fill('Discard this title')
    await detail.getByTestId('community-edit-cancel').click()
    await expect(edit).toBeFocused()
    await expect(detail).toHaveAccessibleName(original.title)

    await edit.click()
    await expect(editTitle).toHaveValue(original.title)
    await expect(editDescription).toHaveValue(original.caption)
    await editTitle.fill(updated.title)
    await editDescription.fill(updated.caption)
    const url = `**/api/v1/community/posts/${postId}/text`
    const failed = interceptNetworkCall({
      url,
      method: 'PATCH',
      fulfillResponse: { status: 503, body: { message: 'Temporary save failure' } },
    })
    const save = detail.getByTestId('community-edit-save')
    await save.click()
    expect((await failed).status).toBe(503)
    await expect(detail.getByRole('alert')).toContainText('save your changes')
    await expect(detail).toHaveAccessibleName(original.title)
    await expect(detail.getByTestId('community-detail-caption')).toHaveText(
      original.caption
    )
    await expect(editTitle).toHaveValue(updated.title)
    await expect(editDescription).toHaveValue(updated.caption)

    await page.unroute(url)
    const saved = interceptNetworkCall({ url, method: 'PATCH' })
    await save.click()
    const response = await saved
    expect(response.status).toBe(200)
    expect(
      editCommunityPostTextResponseSchema.parse(response.responseJson).data
    ).toMatchObject(updated)
    await expect(detail).toHaveAccessibleName(updated.title)
    await expect(detail.getByTestId('community-detail-caption')).toHaveText(
      updated.caption
    )
    await expect(editTitle).toHaveCount(0)

    await test.step('Reopen the saved post at 320 px with 200% root text', async () => {
      await page.setViewportSize({ width: 320, height: 760 })
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = '200%'
        })
      })
      await page.reload()
      await expect(page.locator('html')).toHaveCSS('font-size', '32px')
      const refreshedFeed = completedCommunityFeed(page, 'all')
      await page.getByRole('button', { name: 'Every climate', exact: true }).click()
      expect((await refreshedFeed).status).toBe(200)
      await expect(card.getByTestId(`title-${postId}`)).toHaveText(updated.title)
      await expect(card.getByTestId(`caption-${postId}`)).toHaveText(updated.caption)
      await card.getByTestId(`lookbook-open-${postId}`).click()
      await expect(detail).toHaveAccessibleName(updated.title)
      await expect(detail.getByTestId('community-detail-caption')).toHaveText(
        updated.caption
      )
    })
  }
)
