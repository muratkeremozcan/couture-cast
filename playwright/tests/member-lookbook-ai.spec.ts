// Learning path Step 80: AI-written look ideas.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-80-ai-written-look-ideas
import type { Locator, Page } from '@playwright/test'
import type { InterceptNetworkCallFn } from '@seontechnologies/playwright-utils/intercept-network-call'
import { styleProfileResponseSchema } from '@couture/api-client/contracts/http'
import { createMemberLookbook } from '@couture/utils'
import { expect, test } from '../support/fixtures/merged-fixtures'
import { FIXED_NOW, waitForShellSettled } from '../support/helpers/app-shell'
import { openLooksFixture } from '../support/helpers/looks-fixtures'

const PROFILE = styleProfileResponseSchema.parse({
  data: {
    mood: 'classic',
    palette: 'neutral',
    texture: 'smooth',
    fit: 'fitted',
    avoid: [],
  },
})
const WEATHER = 'warm-dry'
const MOODS = /^lookbook-mood-(active|chic|classic|cozy)$/
const RULE_ORDER = ['Classic', 'Chic', 'Sporty']
const GENERATED_ORDER = ['Sporty', 'Chic', 'Classic']
const fixtureIdeas = createMemberLookbook(WEATHER, { profile: PROFILE.data })
const fixtureRanking = fixtureIdeas
  .map(({ result }, index) => ({
    lookId: result.look!.id,
    description: [
      'A polished mix for the day.',
      'A sporty mix for the day.',
      'A cozy mix for the day.',
    ][index]!,
  }))
  .reverse()

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function pieceIds(card: Locator) {
  return card
    .getByTestId(/^lookbook-piece-/)
    .evaluateAll((pieces) => pieces.map((piece) => piece.getAttribute('data-piece-id')))
}

async function prepareIdeas(
  page: Page,
  interceptNetworkCall: InterceptNetworkCallFn,
  data: typeof fixtureRanking | null = fixtureRanking
) {
  const { router } = await openLooksFixture(page, interceptNetworkCall, {
    mode: 'empty-closet',
    storedSession: true,
  })
  void interceptNetworkCall({
    url: '**/api/v1/personalization/style-profile',
    method: 'GET',
    fulfillResponse: { body: PROFILE },
  })
  const responseGate = deferred<void>()
  const responseSent = deferred<void>()
  const request = interceptNetworkCall({
    url: '**/api/v1/personalization/look-ideas',
    method: 'POST',
    handler: async (route) => {
      await responseGate.promise
      await route.fulfill({ json: { data } })
      responseSent.resolve()
    },
  })
  await page.clock.setFixedTime(FIXED_NOW)
  const lookbook = page.getByTestId('member-lookbook')
  const card = lookbook.getByTestId('looks-idea-card-current')
  const description = lookbook.getByTestId('lookbook-ai-description')
  const newIdeas = lookbook.getByRole('button', { name: 'New ideas ready' })
  const moods = lookbook.getByTestId(MOODS)
  const firstLook = fixtureIdeas[0]!.result.look!.id

  async function open() {
    await page.goto('/looks?segment=ideas')
    await waitForShellSettled(page, router)
    await expect(card).toBeVisible({ timeout: 1_000 })
    const { requestJson } = await request
    expect(requestJson).toEqual({ weather: WEATHER, profile: PROFILE.data })
    await expect(card).toHaveAttribute('data-look-id', firstLook)
    await expect(moods).toHaveText(RULE_ORDER)
    await expect(description).toHaveCount(0)
    await expect(newIdeas).toHaveCount(0)
  }

  return {
    open,
    lookbook,
    card,
    description,
    newIdeas,
    moods,
    firstLook,
    release: () => responseGate.resolve(),
    responseSent: responseSent.promise,
  }
}

test.use({
  authSessionEnabled: false,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
})

test.describe('CC-7.23 AI-written look ideas @local-lane', () => {
  test('[P0] opens Ideas while forecast, style, and Saved reads are held', async ({
    page,
    interceptNetworkCall,
  }) => {
    const fixture = await openLooksFixture(page, interceptNetworkCall, {
      mode: 'empty-closet',
      storedSession: true,
    })
    const releaseForecast = fixture.router.hold('ritual')
    const releaseProfile = fixture.router.hold('style-profile')
    const releaseSaved = fixture.hold('saved-looks')
    await page.clock.setFixedTime(FIXED_NOW)

    try {
      await page.goto('/looks?segment=ideas')
      await expect(page.getByTestId('looks-segment-ideas')).toBeVisible()
      const card = page.getByTestId('looks-idea-card-current')
      await expect(card).toBeVisible({ timeout: 1_000 })
      await expect(card.getByTestId('lookbook-piece-shoes')).toBeVisible()
      await expect(card.getByTestId('lookbook-weather-reason')).toHaveText(/\S/)
      await expect(page.getByTestId('lookbook-ai-description')).toHaveCount(0)
      expect(fixture.router.calls('look-ideas')).toBe(0)
    } finally {
      releaseForecast()
      releaseProfile()
      releaseSaved()
    }
  })

  test('[P0] shows a rule-based look first and promotes the top-ranked idea', async ({
    page,
    interceptNetworkCall,
  }) => {
    const ideas = await prepareIdeas(page, interceptNetworkCall)
    try {
      await ideas.open()
    } finally {
      ideas.release()
    }

    const top = fixtureRanking[0]!
    expect(top.lookId).not.toBe(ideas.firstLook)
    await expect(ideas.card).toHaveAttribute('data-look-id', top.lookId)
    await expect(ideas.description).toHaveText(top.description)
    await expect(ideas.moods).toHaveText(GENERATED_ORDER)
    await expect(ideas.newIdeas).toHaveCount(0)
  })

  test('[P0] preserves an edited look and applies its description on request', async ({
    page,
    interceptNetworkCall,
  }) => {
    const ideas = await prepareIdeas(page, interceptNetworkCall)
    const pin = ideas.lookbook.getByTestId('lookbook-pin-shoes')
    const firstMood = ideas.lookbook.getByTestId(`lookbook-mood-${fixtureIdeas[0]!.mood}`)
    let edited: (string | null)[]
    try {
      await ideas.open()
      const original = await pieceIds(ideas.card)
      await pin.click()
      await ideas.lookbook.getByTestId('lookbook-shuffle').click()
      edited = await pieceIds(ideas.card)
      expect(edited).not.toEqual(original)
      await expect(pin).toHaveAttribute('aria-pressed', 'true')
    } finally {
      ideas.release()
    }

    await expect(ideas.newIdeas).toBeVisible()
    await expect(ideas.card).toHaveAttribute('data-look-id', ideas.firstLook)
    await expect(ideas.description).toHaveCount(0)
    await expect(ideas.moods).toHaveText(RULE_ORDER)
    expect(await pieceIds(ideas.card)).toEqual(edited)

    await ideas.newIdeas.click()
    await expect(ideas.description).toHaveText(fixtureRanking.at(-1)!.description)
    await expect(ideas.moods).toHaveText(GENERATED_ORDER)
    await expect(ideas.card).toHaveAttribute('data-look-id', ideas.firstLook)
    await expect(firstMood).toHaveAttribute('aria-pressed', 'true')
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await expect(ideas.newIdeas).toHaveCount(0)
    expect(await pieceIds(ideas.card)).toEqual(edited)
  })

  test('[P0] the rule-based look stays editable when generation is unavailable', async ({
    page,
    interceptNetworkCall,
  }) => {
    const ideas = await prepareIdeas(page, interceptNetworkCall, null)
    try {
      await ideas.open()
    } finally {
      ideas.release()
    }

    await ideas.responseSent
    const pin = ideas.lookbook.getByTestId('lookbook-pin-shoes')
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await expect(ideas.card).toHaveAttribute('data-look-id', ideas.firstLook)
    await expect(ideas.description).toHaveCount(0)
    await expect(ideas.moods).toHaveText(RULE_ORDER)
    await expect(ideas.newIdeas).toHaveCount(0)
  })
})
