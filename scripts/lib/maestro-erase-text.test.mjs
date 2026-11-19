import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import {
  MAX_ERASE_TEXT_COUNT,
  eraseTextCounts,
  eraseTextViolations,
  maestroFlowFiles,
} from './maestro-erase-text.mjs'
import { DOUBLE_PLACES, sentinelPlace } from './weather-provider-double-data.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const erasedTotal = (source) =>
  eraseTextCounts(source).reduce((sum, count) => sum + count, 0)

describe('Maestro eraseText stays inside the 120 s device deadline', () => {
  test('every eraseText in maestro/ names a count of 1 to 10', () => {
    const flows = maestroFlowFiles(root)
    assert.ok(flows.includes('maestro/garment-capsule-create-flow.yaml'))
    assert.ok(flows.some((flow) => flow.startsWith('maestro/subflows/')))
    const offenders = flows.flatMap((flow) =>
      eraseTextViolations(read(flow)).map((violation) => `${flow}:${violation}`)
    )
    assert.deepEqual(offenders, [])
  })

  test('the bound keeps 10 s per press under the 120 s deadline with margin', () => {
    assert.equal(MAX_ERASE_TEXT_COUNT, 10)
    assert.ok(MAX_ERASE_TEXT_COUNT * 10 <= 100)
  })

  test('a bare eraseText fails, as a list item, an empty key or an empty mapping', () => {
    for (const source of [
      '- eraseText\n',
      'appId: app\n---\n- tapOn: x\n- eraseText:\n',
      '- eraseText:\n    label: clear\n',
    ]) {
      const violations = eraseTextViolations(source)
      assert.equal(violations.length, 1, source)
      assert.match(violations[0], /bare eraseText erases Maestro's default 50 characters/)
    }
  })

  test('an oversized, zero or non-literal count fails, and reports its line', () => {
    assert.match(
      eraseTextViolations('- tapOn: x\n- eraseText: 11\n')[0],
      /^2: eraseText: 11 is outside 1 to 10/
    )
    assert.match(eraseTextViolations('- eraseText: 0\n')[0], /eraseText: 0 is outside/)
    assert.match(
      eraseTextViolations('- eraseText:\n    charactersToErase: 50\n')[0],
      /eraseText: 50 is outside/
    )
    assert.match(
      eraseTextViolations('- eraseText: ${COUNT}\n')[0],
      /is not a literal integer/
    )
  })

  test('nested commands are checked: retry, repeat, runFlow and onFlowStart', () => {
    const source = [
      'appId: app',
      'onFlowStart:',
      '  - eraseText: 40',
      '---',
      '- retry:',
      '    commands:',
      '      - repeat:',
      '          times: 2',
      '          commands:',
      '            - eraseText',
      '- runFlow:',
      '    when:',
      '      platform: Android',
      '    commands:',
      '      - eraseText: 12',
      '',
    ].join('\n')
    assert.deepEqual(
      eraseTextViolations(source).map((violation) => violation.split(':')[0]),
      ['3', '10', '15']
    )
  })

  test('bounded counts pass in both forms', () => {
    assert.deepEqual(eraseTextViolations('- eraseText: 10\n- eraseText: 1\n'), [])
    assert.deepEqual(eraseTextViolations('- eraseText:\n    charactersToErase: 8\n'), [])
  })
})

describe('the flows that erase', () => {
  test('location capture erases exactly the prefilled sentinel city', () => {
    const city = sentinelPlace('any nonce').name
    assert.equal(city.length, 13)
    assert.equal(erasedTotal(read('maestro/location-capture.yaml')), city.length)
  })

  test('Use my location erases exactly the prefilled city the double resolves', () => {
    const chicago = DOUBLE_PLACES.find((place) => place.name === 'Chicago')
    assert.equal(chicago?.name.length, 7)
    assert.equal(erasedTotal(read('maestro/location-use-my-location.yaml')), 7)
  })

  test('the erased total counts every form the deadline rule accepts', () => {
    const source = [
      '- eraseText: 7',
      '- eraseText: 6',
      '- runFlow:',
      '    commands:',
      '      - eraseText:',
      '          charactersToErase: 1',
      '',
    ].join('\n')
    assert.deepEqual(eraseTextViolations(source), [])
    assert.deepEqual(eraseTextCounts(source), [7, 6, 1])
    assert.equal(erasedTotal(source), 14)
    assert.notEqual(erasedTotal(source), sentinelPlace('any nonce').name.length)
    assert.deepEqual(eraseTextCounts('- eraseText\n- eraseText: ${COUNT}\n'), [50, NaN])
  })

  test('the capsule name retry erases only typed text, in bounded chunks that cover a failed attempt', () => {
    const flow = parse(
      read('maestro/garment-capsule-create-flow.yaml').split('\n---\n')[1]
    )
    const retry = flow.find((step) =>
      step.retry?.commands?.some((command) => command.inputText === 'Maestro capsule')
    ).retry
    const repeat = retry.commands[0].repeat
    assert.equal(repeat.while.visible.id, 'capsule-name-input')
    assert.deepEqual(repeat.commands, [{ eraseText: 8 }])
    // A failed attempt leaves at most a doubled first character (16) plus one repeated delivery
    // of the name (15).
    const name = 'Maestro capsule'
    assert.ok(
      repeat.times * repeat.commands[0].eraseText >= name.length + 1 + name.length
    )

    // Android reports an empty field's placeholder as its text, so the condition must reject it.
    const locale = JSON.parse(read('apps/mobile/assets/locales/en-US.json'))
    const placeholder = locale.wardrobe.capsules.namePlaceholder
    assert.equal(repeat.while.visible.text, `(?!${placeholder}$).+`)
    const typed = new RegExp(`^${repeat.while.visible.text}$`, 'is')
    assert.equal(typed.test(placeholder), false)
    assert.equal(typed.test(''), false)
    assert.equal(typed.test('MMaestro capsule'), true)
    assert.equal(typed.test('M'), true)
  })
})
