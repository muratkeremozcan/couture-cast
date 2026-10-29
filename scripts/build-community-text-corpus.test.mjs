import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { importHoldout, parseLocales } from './build-community-text-corpus.mjs'

// Synthetic captions only: no holdout text appears here.
const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr']
const VERSION = 'holdout-v60'
let work
let input
let output

function writeInput(locales) {
  for (const locale of locales) {
    fs.writeFileSync(
      path.join(input, `holdout-${locale}.json`),
      JSON.stringify([
        { text: `Synthetic caption one for ${locale}`, field: 'caption' },
        { text: `Synthetic alt text two for ${locale}`, field: 'altText' },
      ])
    )
  }
}
const written = () =>
  fs.existsSync(path.join(output, VERSION))
    ? fs.readdirSync(path.join(output, VERSION)).toSorted()
    : []
const quietly = async (run) => {
  const log = console.log
  console.log = () => undefined
  try {
    return await run()
  } finally {
    console.log = log
  }
}

describe('holdout importer per locale', () => {
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68x-importer-'))
    input = path.join(work, 'input')
    output = path.join(work, 'output')
    fs.mkdirSync(input)
  })
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }))

  test('--locales pt writes one file and creates none for the other locales', async () => {
    writeInput(LOCALES)
    await quietly(() =>
      importHoldout(input, VERSION, { outputDir: output, locales: ['pt'] })
    )
    assert.deepEqual(written(), ['pt.json'])
    const file = JSON.parse(
      fs.readFileSync(path.join(output, VERSION, 'pt.json'), 'utf8')
    )
    assert.equal(file.corpusVersion, VERSION)
    assert.deepEqual(
      file.entries.map((entry) => entry.id),
      ['pt-holdout-v60-001', 'pt-holdout-v60-002']
    )
  })

  test('running it again leaves the written locale unchanged', async () => {
    writeInput(LOCALES)
    const options = { outputDir: output, locales: ['pt'] }
    await quietly(() => importHoldout(input, VERSION, options))
    const before = fs.readFileSync(path.join(output, VERSION, 'pt.json'))
    fs.writeFileSync(
      path.join(input, 'holdout-pt.json'),
      JSON.stringify([{ text: 'A different synthetic caption', field: 'caption' }])
    )
    await quietly(() => importHoldout(input, VERSION, options))
    assert.deepEqual(fs.readFileSync(path.join(output, VERSION, 'pt.json')), before)
  })

  test('naming a second locale later adds it and keeps the first', async () => {
    writeInput(LOCALES)
    await quietly(() =>
      importHoldout(input, VERSION, { outputDir: output, locales: ['pt'] })
    )
    await quietly(() =>
      importHoldout(input, VERSION, { outputDir: output, locales: ['pt', 'de'] })
    )
    assert.deepEqual(written(), ['de.json', 'pt.json'])
  })

  test('omitting --locales writes all seven', async () => {
    writeInput(LOCALES)
    await quietly(() => importHoldout(input, VERSION, { outputDir: output }))
    assert.deepEqual(
      written(),
      LOCALES.map((locale) => `${locale}.json`)
    )
  })

  test('a named locale without an input file fails with its name and writes nothing', async () => {
    writeInput(['pt'])
    await assert.rejects(
      quietly(() =>
        importHoldout(input, VERSION, { outputDir: output, locales: ['pt', 'tr'] })
      ),
      /tr: no input file holdout-tr\.json/
    )
    assert.deepEqual(written(), [])
  })

  test('an unknown, empty or repeated locale list is refused', async () => {
    writeInput(LOCALES)
    for (const locales of [['xx'], [], ['pt', 'pt']]) {
      await assert.rejects(
        quietly(() => importHoldout(input, VERSION, { outputDir: output, locales })),
        /locales/
      )
    }
    assert.deepEqual(written(), [])
  })

  test('parseLocales reads a comma list and leaves an absent flag as every locale', () => {
    assert.deepEqual(parseLocales(['--import-holdout', 'x', '--locales', 'pt,tr']), [
      'pt',
      'tr',
    ])
    assert.equal(parseLocales(['--import-holdout', 'x']), undefined)
    assert.throws(() => parseLocales(['--locales']), /locales/)
  })

  test('runs when started through a symlinked path and reports its error', () => {
    const link = path.join(work, 'linked-scripts')
    fs.symlinkSync(path.dirname(fileURLToPath(import.meta.url)), link)
    const result = spawnSync(
      process.execPath,
      [
        path.join(link, 'build-community-text-corpus.mjs'),
        '--import-holdout',
        input,
        '--holdout-version',
        VERSION,
        '--locales',
        'pt',
      ],
      { encoding: 'utf8' }
    )
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /pt: no input file holdout-pt\.json/)
  })
})
