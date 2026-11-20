import {
  COMMUNITY_POST_TEXT_HEADER,
  communityPostResponseSchema,
  editCommunityPostTextResponseSchema,
} from '@couture/api-client/contracts/http'
import { authHeaders, buildUniqueId } from '../../support/helpers/api-test'
import {
  communityApiTest as test,
  expect,
  loadCommunityFixture,
  publishCommunityLook,
  signUpCommunityUser,
  waitForTerminalAuthorState,
} from '../../support/helpers/community-session'

test('[P0] Only the owner can revise legacy post text; stale and rejected writes retain approved text @local-lane', async ({
  apiRequest,
  communityApi,
  recurse,
  request,
}, testInfo) => {
  const { apiBaseUrl: baseUrl, userId, headers, trackUser } = communityApi
  const originalCaption = 'Layers for a cool evening'
  const postId = await test.step('Publish a legacy post with a description', async () => {
    const { postId } = await publishCommunityLook(request, {
      apiBaseUrl: baseUrl,
      userId,
      fixture: loadCommunityFixture('safe-satin-plum-512x512.jpg'),
      altText: 'A plum satin wrap dress.',
      caption: originalCaption,
    })
    const terminal = await waitForTerminalAuthorState(
      { apiRequest, recurse },
      { apiBaseUrl: baseUrl, userId, postId }
    )
    expect(terminal.status).toBe('published')
    return postId
  })

  const viewer = await signUpCommunityUser(
    request,
    baseUrl,
    buildUniqueId('post-viewer', testInfo)
  )
  trackUser(viewer)
  const viewerHeaders = {
    ...authHeaders(viewer, 'guardian'),
    'x-couture-platform': 'web',
  }
  const textHeader = { [COMMUNITY_POST_TEXT_HEADER]: '1' }
  const path = `/api/v1/community/posts/${postId}`
  const modernRead = {
    method: 'GET' as const,
    path,
    baseUrl,
    headers: { ...viewerHeaders, ...textHeader },
  }
  const ownerRead = { ...modernRead, headers: { ...headers, ...textHeader } }
  const previous =
    await test.step('Read the untitled post and its owner-only revision', async () => {
      const before = await apiRequest(modernRead)
      expect(before.status).toBe(200)
      const post = communityPostResponseSchema.parse(before.body).data
      expect(post).toMatchObject({ title: null, caption: originalCaption })
      expect(post).not.toHaveProperty('textRevision')
      const ownBefore = await apiRequest(ownerRead)
      expect(ownBefore.status).toBe(200)
      const { textRevision } = communityPostResponseSchema.parse(ownBefore.body).data
      expect(textRevision).toBe(0)
      return post
    })

  const change = {
    baseRevision: 0,
    title: 'Plum evening layers',
    caption: 'A wrap dress and light jacket',
  }
  const patch = {
    method: 'PATCH' as const,
    path: `${path}/text`,
    baseUrl,
    headers,
    body: change,
  }
  const approved = { title: change.title, caption: change.caption, textRevision: 1 }
  await test.step('Reject the viewer edit and save the owner edit', async () => {
    const foreign = await apiRequest({ ...patch, headers: viewerHeaders })
    expect(foreign.status).toBe(404)
    const updated = await apiRequest(patch)
    expect(updated.status).toBe(200)
    expect(editCommunityPostTextResponseSchema.parse(updated.body).data).toEqual(approved)
  })

  await test.step('Keep the edited description compatible with legacy clients', async () => {
    const legacy = await apiRequest({
      method: 'GET',
      path,
      baseUrl,
      headers: viewerHeaders,
    })
    expect(legacy.status).toBe(200)
    const legacyPost = communityPostResponseSchema.parse(legacy.body).data
    expect(legacyPost.caption).toBe(change.caption)
    expect(legacyPost).not.toHaveProperty('title')
    expect(legacyPost).not.toHaveProperty('textRevision')
  })

  await test.step('Reject stale revisions and text that fails screening', async () => {
    const stale = await apiRequest({ ...patch, body: { ...change, title: 'Stale edit' } })
    expect(stale.status).toBe(409)
    const rejected = await apiRequest({
      ...patch,
      body: {
        ...change,
        baseRevision: 1,
        title: 'merde what a night',
        caption: 'This draft should stay private',
      },
    })
    expect(rejected.status).toBe(400)
  })

  await test.step('Count approved and withheld edits together and return Retry-After', async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const withheld = await apiRequest({
        ...patch,
        body: { ...change, baseRevision: 1, title: 'merde what a night' },
      })
      expect(withheld.status).toBe(400)
    }
    const limited = await request.patch(`${baseUrl}${path}/text`, {
      headers,
      data: { ...change, baseRevision: 1, title: 'A fresh approved title' },
    })
    expect(limited.status()).toBe(429)
    const retryAfter = Number(limited.headers()['retry-after'])
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(3600)
  })

  await test.step('Read back the approved text and original photo after the refusals', async () => {
    const readback = await apiRequest(modernRead)
    expect(readback.status).toBe(200)
    const post = communityPostResponseSchema.parse(readback.body).data
    expect(post).toMatchObject({
      title: approved.title,
      caption: approved.caption,
      id: postId,
      status: 'published',
      altText: previous.altText,
      publishedAt: previous.publishedAt,
    })
    expect(post).not.toHaveProperty('textRevision')
    expect(new URL(post.imageAccess.url).pathname).toBe(
      new URL(previous.imageAccess.url).pathname
    )
    const ownerAfter = await apiRequest(ownerRead)
    expect(ownerAfter.status).toBe(200)
    expect(communityPostResponseSchema.parse(ownerAfter.body).data).toMatchObject(
      approved
    )
  })
})
