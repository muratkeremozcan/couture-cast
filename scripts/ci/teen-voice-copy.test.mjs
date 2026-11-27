// Learning path Step 74: Teen voice and copy.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-74-teen-voice-and-copy
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function readJson(path) {
  return JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))
}

const locales = Object.keys(
  readJson('packages/api-client/src/contracts/http/supported-locales.json')
)
const webPath = 'apps/web/src/i18n/locales'
const nativePath = 'apps/mobile/assets/locales'
const exportPath = 'apps/api/src/modules/share-cards/assets'

const sharedKeys = [
  'commerce.premium.planner.starterWardrobe',
  'community.calm.climateEmpty',
  'community.compose.altHint',
  'community.compose.altPlaceholder',
  'community.compose.altSuggested',
  'community.filters.explainer',
  'community.filters.label',
  'community.notifications.signinCodeInvalid',
  'community.notifications.signinDenied',
  'community.notifications.signinUnavailable',
  'community.report.description',
  'home.today.weatherUnavailable',
  'looks.freePlan.line',
  'savedLooks.missingPieceDetail',
  'savedLooks.needsReviewDetail',
  'settings.profile.aboutHelp',
  'shareCard.photoPrivacyHelp',
  'shareCard.previewDescription',
  'shareCard.render',
  'shareCard.sourceUnavailable',
  'shareCard.storage',
  'wardrobe.capsules.namePlaceholder',
]
const sharedButtons = [
  'community.compose.editText',
  'home.spotlightTeaser.cta',
  'home.today.addFirstPiece',
  'shareCard.launcher',
]
const webKeys = [
  'settings.profile.browserLanguageHelp',
  'wardrobe.hub.accountFailed',
  'wardrobe.hub.accountFailedShort',
  'wardrobe.hub.emptyBody',
  'wardrobe.hub.emptyTitle',
  'wardrobe.hub.loading',
  'wardrobe.hub.refreshFailed',
  'wardrobe.hub.setupFailed',
  'wardrobe.hub.statusRefreshFailed',
  'wardrobe.hub.taggingSlow',
  'wardrobe.onboarding.errors.loadFailed',
  'wardrobe.onboarding.errors.saveFailed',
  'wardrobe.onboarding.errors.stale',
  'wardrobe.onboarding.announcements.permissionDenied',
  'wardrobe.onboarding.permissionBody',
  'wardrobe.onboarding.permissionDenied',
  'wardrobe.onboarding.permissionTitle',
]
const nativeKeys = [
  'hero.hourly_forecast',
  'hero.load_error',
  'hero.wetWeatherChance.likely',
  'hero.wetWeatherChance.none',
  'hero.wetWeatherChance.possible',
  'wardrobe.empty_desc',
  'wardrobe.empty_title',
  'wardrobe.hub.loading',
  'wardrobe.onboarding.errors.load_failed',
  'wardrobe.onboarding.errors.save_failed',
  'wardrobe.onboarding.permission_body',
  'wardrobe.onboarding.permission_denied',
  'wardrobe.tagging.poll_timeout',
]
const webButtons = [
  'wardrobe.hub.emptyAction',
  'wardrobe.onboarding.addAnother',
  'wardrobe.onboarding.permissionAction',
  'wardrobe.onboarding.useStarterWardrobe',
  'wardrobe.silhouette.myFormRemove',
  'wardrobe.tagEditor.save',
]
const nativeButtons = [
  'wardrobe.add_garment',
  'wardrobe.onboarding.add_another',
  'wardrobe.onboarding.permission_title',
  'wardrobe.onboarding.use_starter_wardrobe',
  'wardrobe.silhouette.my_form_remove',
  'wardrobe.tagging.save',
]

const copyAt = (catalog, key) =>
  key.split('.').reduce((value, part) => value?.[part], catalog)
const placeholders = (copy) => copy.match(/\{\{\w+\}\}/g)?.sort() ?? []
const englishWeb = readJson(`${webPath}/en-US.json`)
const englishNative = readJson(`${nativePath}/en-US.json`)

for (const locale of locales) {
  test(`[7.17-I18N-001] every teen copy update ships in ${locale}`, () => {
    const web = readJson(`${webPath}/${locale}.json`)
    const native = readJson(`${nativePath}/${locale}.json`)
    const share = readJson(`${exportPath}/${locale}.json`)
    const isEnglish = locale.startsWith('en-')

    for (const [catalog, reference, keys, buttons] of [
      [web, englishWeb, webKeys, webButtons],
      [native, englishNative, nativeKeys, nativeButtons],
    ]) {
      for (const key of [...sharedKeys, ...keys, ...sharedButtons, ...buttons]) {
        const copy = copyAt(catalog, key)
        const english = copyAt(reference, key)
        assert.ok(typeof copy === 'string' && copy.trim(), `${locale} ${key} has copy`)
        assert.deepEqual(
          placeholders(copy),
          placeholders(english),
          `${locale} ${key} placeholders`
        )
        if (!isEnglish) assert.notEqual(copy, english, `${locale} ${key} translation`)
      }
      if (isEnglish) {
        for (const key of [...sharedButtons, ...buttons]) {
          assert.ok(
            copyAt(catalog, key).trim().split(/\s+/).length <= 3,
            `${locale} ${key} words`
          )
        }
      }
    }

    assert.deepEqual(web.shareCard.scenarios, share.scenarios)
    assert.deepEqual(native.shareCard.scenarios, share.scenarios)
    assert.deepEqual(native.hero.scenarios, share.scenarios)
    for (const scenario of ['morning', 'midday', 'evening']) {
      assert.ok(share.scenarios[scenario]?.trim(), `${locale} ${scenario} has copy`)
    }
  })
}
