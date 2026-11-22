// Learning path Step 62: Community post edits persist.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-62-community-post-edits-persist
import {
  COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE,
  editCommunityPostTextResponseSchema,
  publishCommunityPostResponseSchema,
} from '@couture/api-client/contracts/http'
import { seedWebSession } from '../support/helpers/commerce-session'
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
  async ({
    apiRequest,
    browser,
    communitySession,
    interceptNetworkCall,
    page,
    recurse,
  }) => {
    const fixture = loadCommunityFixture('safe-satin-plum-512x512.jpg')
    const original = { title: 'Plum layers', caption: 'Layers for a cool evening' }
    const titleOnly = { title: 'Plum satin layers', caption: original.caption }
    const captionOnly = {
      title: titleOnly.title,
      caption: 'Warm wrap dress for cool evenings',
    }
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

    const secondContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    })
    try {
      await seedWebSession(secondContext, communitySession.accessToken)
      const secondPage = await secondContext.newPage()
      await secondPage.goto('/community')
      const secondFeed = completedCommunityFeed(secondPage, 'all')
      await secondPage.getByRole('button', { name: 'Every climate', exact: true }).click()
      expect((await secondFeed).status).toBe(200)
      await expect(secondPage.getByTestId(`lookbook-card-${postId}`)).toBeVisible()

      await page.reload()
      const initialFeed = completedCommunityFeed(page, 'all')
      await page.getByRole('button', { name: 'Every climate', exact: true }).click()
      expect((await initialFeed).status).toBe(200)
      const card = page.getByTestId(`lookbook-card-${postId}`)
      await expect(card.getByTestId(`title-${postId}`)).toHaveText(original.title)
      await expect(card.getByTestId(`caption-${postId}`)).toHaveText(original.caption)
      await expect(card.getByTestId(`edited-badge-${postId}`)).toHaveCount(0)
      await card.getByTestId(`lookbook-open-${postId}`).click()

      const detail = page.getByRole('dialog')
      await expect(detail).toHaveAccessibleName(original.title)
      await expect(detail.getByTestId('community-detail-edited')).toHaveCount(0)
      const edit = detail.getByTestId('community-edit-text')
      const editTitle = detail.getByTestId('community-edit-title')
      const editDescription = detail.getByTestId('community-edit-description')
      const save = detail.getByTestId('community-edit-save')
      const url = `**/api/v1/community/posts/${postId}/text`

      await edit.click()
      await expect(editTitle).toBeFocused()
      await editTitle.fill('Discard this title')
      await detail.getByTestId('community-edit-cancel').click()
      await expect(edit).toBeFocused()
      await expect(detail).toHaveAccessibleName(original.title)

      await test.step('Distinct failure messages keep approved text visible and retain draft', async () => {
        await edit.click()
        await expect(editTitle).toHaveValue(original.title)
        await expect(editDescription).toHaveValue(original.caption)
        await editTitle.fill('merde what a coat')
        const rejected = interceptNetworkCall({ url, method: 'PATCH' })
        await save.click()
        expect((await rejected).status).toBe(400)
        await expect(detail.getByRole('alert')).toContainText('community guidelines')
        await expect(detail).toHaveAccessibleName(original.title)
        await expect(editTitle).toHaveValue('merde what a coat')

        await editTitle.fill(updated.title)
        await editDescription.fill(updated.caption)
        const screeningUnavailable = interceptNetworkCall({
          url,
          method: 'PATCH',
          fulfillResponse: {
            status: 503,
            body: { message: COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE },
          },
        })
        await save.click()
        expect((await screeningUnavailable).status).toBe(503)
        await expect(detail.getByRole('alert')).toContainText(
          'Text screening is temporarily unavailable'
        )
        await expect(detail).toHaveAccessibleName(original.title)
        await expect(editTitle).toHaveValue(updated.title)
        await expect(editDescription).toHaveValue(updated.caption)

        await page.unroute(url)
        const failed = interceptNetworkCall({
          url,
          method: 'PATCH',
          fulfillResponse: { status: 503, body: { message: 'Temporary save failure' } },
        })
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
      })

      await test.step('Title-only, caption-only, combined, and unchanged edits persist with Edited label', async () => {
        await editTitle.fill(titleOnly.title)
        await editDescription.fill(titleOnly.caption)
        const savedTitle = interceptNetworkCall({ url, method: 'PATCH' })
        await save.click()
        const titleRes = await savedTitle
        expect(titleRes.status).toBe(200)
        expect(
          editCommunityPostTextResponseSchema.parse(titleRes.responseJson).data
        ).toEqual({ ...titleOnly, textRevision: 1 })
        await expect(detail).toHaveAccessibleName(titleOnly.title)
        await expect(detail.getByTestId('community-detail-edited')).toHaveText('Edited')
        await expect(detail.getByTestId('community-edit-status')).toHaveText(
          'Changes saved.'
        )
        await expect(editTitle).toHaveCount(0)

        await edit.click()
        await editDescription.fill(captionOnly.caption)
        const savedCaption = interceptNetworkCall({ url, method: 'PATCH' })
        await save.click()
        const captionRes = await savedCaption
        expect(captionRes.status).toBe(200)
        expect(
          editCommunityPostTextResponseSchema.parse(captionRes.responseJson).data
        ).toEqual({ ...captionOnly, textRevision: 2 })
        await expect(detail.getByTestId('community-detail-caption')).toHaveText(
          captionOnly.caption
        )

        await edit.click()
        await editTitle.fill(updated.title)
        await editDescription.fill(updated.caption)
        const savedCombined = interceptNetworkCall({ url, method: 'PATCH' })
        await save.click()
        const combinedRes = await savedCombined
        expect(combinedRes.status).toBe(200)
        expect(
          editCommunityPostTextResponseSchema.parse(combinedRes.responseJson).data
        ).toEqual({ ...updated, textRevision: 3 })
        await expect(detail).toHaveAccessibleName(updated.title)
        await expect(detail.getByTestId('community-detail-caption')).toHaveText(
          updated.caption
        )

        await edit.click()
        const unchanged = interceptNetworkCall({ url, method: 'PATCH' })
        await save.click()
        const unchangedRes = await unchanged
        expect(unchangedRes.status).toBe(200)
        expect(
          editCommunityPostTextResponseSchema.parse(unchangedRes.responseJson).data
        ).toEqual({ ...updated, textRevision: 3 })
        await expect(detail.getByTestId('community-edit-status')).toHaveText('No changes')
      })

      await test.step('Reload proves both combined editor-saved fields persist before advancing revision', async () => {
        await page.reload()
        const postSaveFeed = completedCommunityFeed(page, 'all')
        await page.getByRole('button', { name: 'Every climate', exact: true }).click()
        expect((await postSaveFeed).status).toBe(200)
        await expect(card.getByTestId(`title-${postId}`)).toHaveText(updated.title)
        await expect(card.getByTestId(`caption-${postId}`)).toHaveText(updated.caption)
        await expect(card.getByTestId(`edited-badge-${postId}`)).toHaveText('Edited')
        await card.getByTestId(`lookbook-open-${postId}`).click()
        await expect(detail).toHaveAccessibleName(updated.title)
        await expect(detail.getByTestId('community-detail-caption')).toHaveText(
          updated.caption
        )
        await expect(detail.getByTestId('community-detail-edited')).toHaveText('Edited')
      })

      await test.step('Already-open second browser client reconciles live edits and surfaces stale revision on conflict', async () => {
        const secondCard = secondPage.getByTestId(`lookbook-card-${postId}`)
        await expect(secondCard.getByTestId(`title-${postId}`)).toHaveText(
          updated.title,
          { timeout: 10_000 }
        )
        await expect(secondCard.getByTestId(`caption-${postId}`)).toHaveText(
          updated.caption
        )
        await expect(secondCard.getByTestId(`edited-badge-${postId}`)).toHaveText(
          'Edited'
        )

        // Open editor on page 1 at revision 3, then advance to revision 4 from second client.
        await edit.click()
        await editTitle.fill('Stale draft from page 1')
        const advanceFromSecond = await apiRequest({
          method: 'PATCH',
          path: `/api/v1/community/posts/${postId}/text`,
          baseUrl: communitySession.apiBaseUrl,
          headers: { Authorization: `Bearer ${communitySession.accessToken}` },
          body: {
            baseRevision: 3,
            title: 'Second client newest title',
            caption: updated.caption,
          },
        })
        expect(advanceFromSecond.status).toBe(200)

        const stale = interceptNetworkCall({ url, method: 'PATCH' })
        await save.click()
        expect((await stale).status).toBe(409)
        await expect(detail.getByRole('alert')).toContainText(
          'changed while you were editing'
        )
        await expect(editTitle).toHaveValue('Stale draft from page 1')
      })

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
        await expect(card.getByTestId(`title-${postId}`)).toHaveText(
          'Second client newest title'
        )
        await expect(card.getByTestId(`caption-${postId}`)).toHaveText(updated.caption)
        await expect(card.getByTestId(`edited-badge-${postId}`)).toHaveText('Edited')
        await card.getByTestId(`lookbook-open-${postId}`).click()
        await expect(detail).toHaveAccessibleName('Second client newest title')
        await expect(detail.getByTestId('community-detail-caption')).toHaveText(
          updated.caption
        )
        await expect(detail.getByTestId('community-detail-edited')).toHaveText('Edited')
      })
    } finally {
      await secondContext.close()
    }
  }
)
