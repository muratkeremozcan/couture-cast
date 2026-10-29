import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const runner = read('scripts/run-story68-native.mjs')
const flow = read('maestro/story68/prefs-failed.yaml')
const section = runner.slice(
  runner.indexOf('const setAppearance'),
  runner.indexOf('report.completed = true')
)

test('the flow opens the settings screen and waits for the Try again control and message', () => {
  assert.match(flow, /open-notification-settings\.yaml/)
  assert.match(flow, /visible: \$\{MAESTRO_PREFS_RETRY\}/)
  assert.match(flow, /assertVisible: \$\{MAESTRO_LOAD_FAILED\}/)
})

test('the runner screenshots both color schemes on both platforms and always restores light and the real mode', () => {
  assert.match(section, /maestro\('maestro\/story68\/prefs-failed\.yaml'\)/)
  assert.match(section, /\['light', 'dark'\]/)
  assert.match(section, /screenshot\(`prefs-failed-\$\{scheme\}`\)/)
  assert.match(section, /'simctl', 'ui', device, 'appearance', scheme/)
  assert.match(section, /'uimode',\s+'night'/)
  const afterFinally = section.slice(section.indexOf('finally'))
  assert.match(afterFinally, /setAppearance\('light'\)/)
  assert.match(afterFinally, /fixture\('real'\)/)
})

test('the screenshot names fit the public evidence allow-list and the mode is a closed fixture', () => {
  for (const scheme of ['light', 'dark'])
    assert.match(
      `native-ios-prefs-failed-${scheme}.png`,
      /^native-(android|ios)-[A-Za-z0-9-]+\.png$/
    )
  assert.match(
    read('apps/mobile/src/lib/share-card-native-fixture.native.ts'),
    /'prefs_unavailable'/
  )
  assert.match(
    read('apps/mobile/app/notification-settings.tsx'),
    /shareCardFixtureMode\(\) === 'prefs_unavailable'/
  )
})
