/**
 * Unit tests for `scripts/check-artifact-secrets.mjs`, the guard every Playwright
 * artifact upload runs first. Lives here because `npm run test:playwright-unit`
 * already runs this directory before every Playwright entrypoint, CI included.
 *
 * Every value below is a dummy. The fixtures reproduce the shapes Playwright
 * actually writes: a blob report zip whose JSON lines carry config, a trace zip
 * nested inside it, and the HTML report's index.html with its data embedded as a
 * base64 zip.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  main,
  parseArgs,
  resolveSecrets,
  scanPaths,
} from '../../../scripts/check-artifact-secrets.mjs'

const DUMMY_SECRET = 'dummy-jwt-secret-0123456789abcdef'
const DUMMY_QUOTED_SECRET = 'dummy"quoted\\secret/value'
const DUMMY_ENV = {
  DUMMY_SECRET,
  DUMMY_QUOTED_SECRET,
}

let workDir: string

function write(relative: string, content: string | Uint8Array) {
  const file = path.join(workDir, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

function scan(names: string[], targets = [workDir]) {
  const { secrets } = resolveSecrets(names, DUMMY_ENV)
  return scanPaths(targets, secrets)
}

function blobReportWith(env: Record<string, string>) {
  const configure = JSON.stringify({
    method: 'onConfigure',
    params: { config: { webServer: { env } } },
  })
  return zipSync({ 'report.jsonl': strToU8(`${configure}\n`) })
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-secret-guard-'))
})

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe('check-artifact-secrets', () => {
  it('passes a tree that holds no secret value', () => {
    write('blob-report/report-1.zip', blobReportWith({ TEST_ENV: 'local' }))
    write('playwright-report/index.html', '<html>no secrets here</html>')

    const result = scan(['DUMMY_SECRET'])

    expect(result.findings).toEqual([])
    expect(result.unreadable).toEqual([])
    expect(result.files).toBe(2)
  })

  it('finds a value serialized into a blob report zip', () => {
    const file = write(
      'blob-report/report-1.zip',
      blobReportWith({ GUARDIAN_INVITE_JWT_SECRET: DUMMY_SECRET })
    )

    expect(scan(['DUMMY_SECRET']).findings).toEqual([
      { location: `${file}!entry#1`, name: 'DUMMY_SECRET', encoding: 'raw' },
    ])
  })

  it('finds a value inside a trace zip nested in a blob report', () => {
    const trace = zipSync({
      'trace.trace': strToU8(
        JSON.stringify({
          type: 'context-options',
          options: { extraHTTPHeaders: { 'x-vercel-protection-bypass': DUMMY_SECRET } },
        })
      ),
    })
    const file = write(
      'blob-report/report-1.zip',
      zipSync({ 'report.jsonl': strToU8('{}\n'), 'resources/abc.zip': trace })
    )

    expect(scan(['DUMMY_SECRET']).findings).toEqual([
      {
        location: `${file}!entry#2(zip)!entry#1`,
        name: 'DUMMY_SECRET',
        encoding: 'raw',
      },
    ])
  })

  it('finds a value in the HTML report data embedded as a base64 zip', () => {
    const data = zipSync({
      'report.json': strToU8(JSON.stringify({ key: DUMMY_SECRET })),
    })
    const encoded = Buffer.from(data).toString('base64')
    const file = write(
      'playwright-report/index.html',
      `<script>window.playwrightReportBase64 = "data:application/zip;base64,${encoded}";</script>`
    )

    const [finding] = scan(['DUMMY_SECRET']).findings
    expect(finding).toEqual({
      location: `${file}!base64#1!entry#1`,
      name: 'DUMMY_SECRET',
      encoding: 'raw',
    })
  })

  it('finds a value inside gzip data', () => {
    write('logs/server.log.gz', zlib.gzipSync(Buffer.from(`token=${DUMMY_SECRET}`)))

    expect(scan(['DUMMY_SECRET']).findings).toHaveLength(1)
  })

  it.each([0, 1, 2])(
    'finds a value base64-encoded %i byte(s) past a 3-byte boundary',
    (offset) => {
      const prefix = 'p'.repeat(offset)
      const attachment = Buffer.from(`${prefix}${DUMMY_SECRET}suffix`).toString('base64')
      write('blob-report/report.jsonl', JSON.stringify({ body: attachment }))

      const file = path.join(workDir, 'blob-report/report.jsonl')
      expect(scan(['DUMMY_SECRET']).findings).toContainEqual({
        location: file,
        name: 'DUMMY_SECRET',
        encoding: 'base64 of raw',
      })
    }
  )

  it('finds a value with JSON metacharacters only present in escaped form', () => {
    const file = write(
      'report.json',
      JSON.stringify({ env: { DUMMY_QUOTED_SECRET } }, null, 2)
    )
    expect(fs.readFileSync(file, 'utf8')).not.toContain(DUMMY_QUOTED_SECRET)

    expect(scan(['DUMMY_QUOTED_SECRET']).findings).toEqual([
      { location: file, name: 'DUMMY_QUOTED_SECRET', encoding: 'json-escaped' },
    ])
  })

  it('finds a URL-encoded value', () => {
    write(
      'trace.network',
      `GET /health?bypass=${encodeURIComponent(DUMMY_QUOTED_SECRET)}`
    )

    expect(scan(['DUMMY_QUOTED_SECRET']).findings[0]?.encoding).toBe('url-encoded')
  })

  it('reports an archive it cannot open instead of passing it unchecked', () => {
    const corrupt = Buffer.from(blobReportWith({ A: 'b' }))
    corrupt.fill(0xff, 30, 60)
    const file = write('blob-report/report-1.zip', corrupt)

    const result = scan(['DUMMY_SECRET'])
    expect(result.unreadable.map((entry) => entry.location)).toEqual([file])
  })

  it('finds a value whose JSON writer escaped it as \\uXXXX', () => {
    const escaped = [...DUMMY_SECRET]
      .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('')
    const file = write('report.json', `{"key":"${escaped}"}`)

    expect(scan(['DUMMY_SECRET']).findings).toEqual([
      { location: `${file}(json-unescaped)`, name: 'DUMMY_SECRET', encoding: 'raw' },
    ])
  })

  it('opens a base64 archive wrapped across lines', () => {
    const data = zipSync({
      'report.json': strToU8(JSON.stringify({ key: DUMMY_SECRET })),
    })
    const wrapped = (
      Buffer.from(data)
        .toString('base64')
        .match(/.{1,76}/g) ?? []
    ).join('\n')
    write('playwright-report/index.html', `<script>const data = "${wrapped}"</script>`)

    expect(scan(['DUMMY_SECRET']).findings).toHaveLength(1)
  })

  it('refuses an archive with duplicate entry names', () => {
    const zip = Buffer.from(
      zipSync({ 'aaaa.txt': strToU8(DUMMY_SECRET), 'bbbb.txt': strToU8('clean') })
    )
    const file = write(
      'blob-report/report-1.zip',
      Buffer.from(zip.toString('latin1').replaceAll('bbbb.txt', 'aaaa.txt'), 'latin1')
    )

    expect(scan(['DUMMY_SECRET']).unreadable).toEqual([
      { location: file, reason: 'duplicate or reserved entry names' },
    ])
  })

  it('refuses an archive with an entry named __proto__', () => {
    const zip = Buffer.from(zipSync({ xxproto__: strToU8(DUMMY_SECRET) }))
    const file = write(
      'blob-report/report-1.zip',
      Buffer.from(zip.toString('latin1').replaceAll('xxproto__', '__proto__'), 'latin1')
    )

    expect(scan(['DUMMY_SECRET']).unreadable).toEqual([
      { location: file, reason: 'duplicate or reserved entry names' },
    ])
  })

  it('fails closed on archives nested past the depth limit', () => {
    let data: Uint8Array = strToU8(DUMMY_SECRET)
    for (let level = 0; level < 12; level += 1) data = zipSync({ 'inner.zip': data })
    write('blob-report/deep.zip', data)

    const result = scan(['DUMMY_SECRET'])
    expect(result.findings).toEqual([])
    expect(result.unreadable).toHaveLength(1)
    expect(result.unreadable[0]?.reason).toMatch(/nested deeper than/)
  })

  it('decodes a base64 attachment body and searches its escaped forms', () => {
    const escaped = [...DUMMY_SECRET]
      .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('')
    const body = Buffer.from(`{"token":"${escaped}"}`).toString('base64')
    write('blob-report/report.jsonl', JSON.stringify({ method: 'onAttach', body }))

    expect(scan(['DUMMY_SECRET']).findings.map((finding) => finding.encoding)).toEqual([
      'raw',
    ])
  })

  it('opens a base64 gzip payload shorter than any archive threshold', () => {
    const shortValue = 'dummy-0042'
    const payload = zlib.gzipSync(Buffer.from(shortValue)).toString('base64')
    expect(payload.length).toBeLessThan(64)
    write('blob-report/report.jsonl', JSON.stringify({ body: payload }))

    const { secrets } = resolveSecrets(['SHORT_DUMMY'], { SHORT_DUMMY: shortValue })
    expect(scanPaths([workDir], secrets).findings).toHaveLength(1)
  })

  it('opens a zip that carries a preamble before its first entry', () => {
    const zip = zipSync({ 'report.json': strToU8(JSON.stringify({ key: DUMMY_SECRET })) })
    const file = write(
      'blob-report/report-1.zip',
      Buffer.concat([Buffer.from('#!/bin/sh preamble\n'), Buffer.from(zip)])
    )

    expect(scan(['DUMMY_SECRET']).findings).toEqual([
      { location: `${file}!entry#1`, name: 'DUMMY_SECRET', encoding: 'raw' },
    ])
  })

  it('treats a stray directory signature in binary data as plain bytes', () => {
    write(
      'artifacts/video.webm',
      Buffer.concat([randomBytes(512), Buffer.from('PK\x05\x06')])
    )

    const result = scan(['DUMMY_SECRET'])
    expect(result.unreadable).toEqual([])
    expect(result.findings).toEqual([])
  })

  it('finds a value in a file name and reports that file by position', () => {
    write(`artifacts/${DUMMY_SECRET}.txt`, 'clean contents')

    expect(scan(['DUMMY_SECRET']).findings).toEqual([
      { location: 'file #1 of this scan(name)', name: 'DUMMY_SECRET', encoding: 'raw' },
    ])
  })

  it('reports missing targets and tolerates them', () => {
    const missing = path.join(workDir, 'absent')
    const result = scan(['DUMMY_SECRET'], [missing])
    expect(result.missing).toEqual([missing])
    expect(result.files).toBe(0)
  })

  it('separates unset and too-short names from scannable ones', () => {
    const { secrets, unset, tooShort } = resolveSecrets(
      ['DUMMY_SECRET', 'UNSET', 'SHORT'],
      {
        DUMMY_SECRET,
        SHORT: 'abc',
      }
    )
    expect(secrets.map((secret) => secret.name)).toEqual(['DUMMY_SECRET'])
    expect(unset).toEqual(['UNSET'])
    expect(tooShort).toEqual(['SHORT'])
  })

  it('parses comma and whitespace separated names', () => {
    expect(
      parseArgs([
        '--names',
        'A, B\nC',
        'dir',
        '--names=D',
        '--storage-state',
        's.json',
        'other',
      ])
    ).toEqual({
      names: ['A', 'B', 'C', 'D'],
      storageStates: ['s.json'],
      targets: ['dir', 'other'],
    })
  })

  describe('main', () => {
    function run(argv: string[], env: NodeJS.ProcessEnv = DUMMY_ENV) {
      const lines: string[] = []
      const out = {
        log: (line: string) => lines.push(line),
        error: (line: string) => lines.push(line),
      }
      return { code: main(argv, env, out), output: lines.join('\n') }
    }

    it('fails with the file and variable name and never the value', () => {
      const file = write(
        'blob-report/report-1.zip',
        blobReportWith({ GUARDIAN_INVITE_JWT_SECRET: DUMMY_SECRET })
      )

      const { code, output } = run(['--names', 'DUMMY_SECRET', workDir])

      expect(code).toBe(1)
      expect(output).toContain(`Secret value of DUMMY_SECRET found in ${file}!entry#1`)
      expect(output).not.toContain(DUMMY_SECRET)
      expect(output).not.toContain(
        Buffer.from(DUMMY_SECRET).toString('base64').slice(0, 12)
      )
    })

    it('names archive entries by position so an entry name cannot carry a value', () => {
      const encodedName = Buffer.from(
        Buffer.from(DUMMY_SECRET).toString('base64')
      ).toString('base64')
      write('blob-report/report-1.zip', zipSync({ [encodedName]: strToU8(DUMMY_SECRET) }))

      const { code, output } = run(['--names', 'DUMMY_SECRET', workDir])

      expect(code).toBe(1)
      expect(output).not.toContain(encodedName)
    })

    it('scans for cookies minted into a storage-state file', () => {
      const cookie = 'dummy-vercel-jwt-cookie-value-0123456789'
      const state = write(
        'auth/vercel-bypass.json',
        JSON.stringify({ cookies: [{ name: '_vercel_jwt', value: cookie }], origins: [] })
      )
      write('artifacts/trace.network', `cookie: _vercel_jwt=${cookie}`)

      const { code, output } = run([
        '--names',
        'DUMMY_SECRET',
        '--storage-state',
        state,
        path.join(workDir, 'artifacts'),
      ])

      expect(code).toBe(1)
      expect(output).toContain('Secret value of cookie _vercel_jwt found in')
      expect(output).not.toContain(cookie)
    })

    it('rejects an unreadable storage-state file without echoing it', () => {
      const state = write('auth/vercel-bypass.json', `{"cookies": [${DUMMY_SECRET}`)

      const { code, output } = run([
        '--names',
        'DUMMY_SECRET',
        '--storage-state',
        state,
        workDir,
      ])

      expect(code).toBe(2)
      expect(output).not.toContain(DUMMY_SECRET)
    })

    it('passes a clean tree and names what it skipped', () => {
      write('blob-report/report-1.zip', blobReportWith({ TEST_ENV: 'local' }))

      const { code, output } = run(['--names', 'DUMMY_SECRET,UNSET_SECRET', workDir])

      expect(code).toBe(0)
      expect(output).toContain('Not set in this job, skipped: UNSET_SECRET')
      expect(output).toContain('No secret values found.')
    })

    it('refuses to run on a value too short to scan for', () => {
      const { code, output } = run(['--names', 'SHORT', workDir], { SHORT: 'abc' })

      expect(code).toBe(2)
      expect(output).not.toContain('abc')
    })

    it('requires names and targets', () => {
      expect(run([workDir]).code).toBe(2)
      expect(run(['--names', 'DUMMY_SECRET']).code).toBe(2)
    })
  })
})
