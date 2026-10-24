/**
 * Unit tests for the real-session artifact set (`scripts/e2e-real-session/artifacts.mjs`)
 * and the CI gate in front of its upload: `artifacts.mjs verify`, then
 * `check-artifact-secrets.mjs --otp-file ... --reject-jwt`.
 *
 * R54: Playwright used to write JUnit and failure output straight into the upload
 * directory, and redaction ran later in teardown, so a run killed before that pass
 * could upload a failure message carrying the OTP it typed. Raw output now stays
 * outside the upload directory, and only a set whose completion record matches it
 * byte for byte passes the gate. Every code, key and JWT below is a dummy.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { main as scanArtifacts } from '../../../scripts/check-artifact-secrets.mjs'
import {
  ARTIFACTS_DIR,
  COMPLETION_RECORD,
  ISSUED_OTPS_FILE,
  RAW_DIR,
  finalizeArtifacts,
  resetArtifacts,
  verifyArtifacts,
} from '../../../scripts/e2e-real-session/artifacts.mjs'
import { redactSecrets } from '../../../scripts/e2e-real-session/harness.mjs'

const CODE = '482913'
const SERVICE_KEY = 'dummy-service-role-key-0123456789'
const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkdW1teS1zdWJqZWN0In0.ZHVtbXktc2lnbmF0dXJlLXZhbHVl'
const artifactsCli = path.resolve(
  __dirname,
  '../../../scripts/e2e-real-session/artifacts.mjs'
)

let directory: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'real-session-artifacts-'))
  resetArtifacts(directory)
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
})

/** What a failing real-session spec leaves in the raw directory. */
function writeFailingRun() {
  const raw = path.join(directory, RAW_DIR)
  fs.writeFileSync(
    path.join(raw, 'junit.xml'),
    [
      '<testsuites id="" name="" tests="6" failures="1" skipped="0" errors="0">',
      `<failure message="locator.fill: Timeout 5000ms exceeded. fill(&quot;${CODE}&quot;)">`,
      `Authorization: Bearer ${JWT}`,
      '</failure>',
      '</testsuites>',
    ].join('\n')
  )
  fs.mkdirSync(path.join(raw, 'test-results', 'n1-chromium'), { recursive: true })
  fs.writeFileSync(
    path.join(raw, 'test-results', 'n1-chromium', 'error-context.md'),
    `apikey ${SERVICE_KEY}`
  )
  fs.writeFileSync(
    path.join(raw, 'test-results', 'n1-chromium', 'screenshot.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
  )
}

function finalize(redact?: Parameters<typeof finalizeArtifacts>[0]['redact']) {
  const raw = path.join(directory, RAW_DIR)
  return finalizeArtifacts({
    directory,
    sources: [
      { to: 'junit.xml', from: path.join(raw, 'junit.xml') },
      { to: 'test-results', from: path.join(raw, 'test-results') },
      { to: 'absent.json', from: path.join(directory, 'absent.json') },
    ],
    texts: [{ to: 'playwright-output.log', content: `typed ${CODE}\n` }],
    secrets: [SERVICE_KEY],
    otpCodes: [CODE],
    ...(redact ? { redact } : {}),
  })
}

function scan() {
  const lines: string[] = []
  const out = {
    log: (line: string) => lines.push(line),
    error: (line: string) => lines.push(line),
  }
  const code = scanArtifacts(
    [
      '--names',
      'SUPABASE_SERVICE_ROLE_KEY',
      '--otp-file',
      path.join(directory, ISSUED_OTPS_FILE),
      '--reject-jwt',
      path.join(directory, ARTIFACTS_DIR),
    ],
    { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY },
    out
  )
  return { code, output: lines.join('\n') }
}

function verifyCli() {
  try {
    execFileSync(process.execPath, [artifactsCli, 'verify'], {
      env: { ...process.env, STORY65_REAL_SESSION_DIR: directory },
      stdio: 'pipe',
    })
    return 0
  } catch (error) {
    return (error as { status: number }).status
  }
}

describe('real-session artifacts', () => {
  it('R54-AR-01 refuses the upload when finalization is interrupted after raw JUnit exists', () => {
    writeFailingRun()
    let redacted = 0

    expect(() =>
      finalize((text, secrets) => {
        // The process dies partway through the redaction pass.
        if (++redacted === 2) throw new Error('killed mid-finalize')
        return redactSecrets(text, secrets)
      })
    ).toThrow('killed mid-finalize')

    expect(fs.existsSync(path.join(directory, COMPLETION_RECORD))).toBe(false)
    expect(fs.existsSync(path.join(directory, ARTIFACTS_DIR))).toBe(false)
    expect(verifyArtifacts(directory)).toEqual({
      ok: false,
      reason: 'no completion record: finalization did not finish',
    })
    expect(verifyCli()).toBe(1)
  })

  it('R54-AR-02 publishes a sanitized failing run that verify and the scan both accept', () => {
    writeFailingRun()

    expect(finalize()).toEqual({ files: 3 })

    const published = path.join(directory, ARTIFACTS_DIR)
    const junit = fs.readFileSync(path.join(published, 'junit.xml'), 'utf8')
    // The diagnostics survive; the values do not.
    expect(junit).toContain(
      'locator.fill: Timeout 5000ms exceeded. fill(&quot;[REDACTED]&quot;)'
    )
    expect(junit).toContain('Bearer [REDACTED_JWT]')
    expect(
      fs.existsSync(path.join(published, 'test-results', 'n1-chromium', 'screenshot.png'))
    ).toBe(false)
    expect(fs.existsSync(path.join(directory, RAW_DIR, 'junit.xml'))).toBe(true)
    expect(verifyArtifacts(directory)).toEqual({ ok: true, files: 3 })
    expect(verifyCli()).toBe(0)
    expect(scan()).toMatchObject({ code: 0 })

    const otps = path.join(directory, ISSUED_OTPS_FILE)
    expect(JSON.parse(fs.readFileSync(otps, 'utf8'))).toEqual([CODE])
    expect(fs.statSync(otps).mode & 0o777).toBe(0o600)
  })

  it('R54-AR-03 refuses a set changed after finalization', () => {
    writeFailingRun()
    finalize()
    const published = path.join(directory, ARTIFACTS_DIR)

    fs.writeFileSync(path.join(published, 'extra.txt'), 'added later')
    expect(verifyArtifacts(directory)).toEqual({
      ok: false,
      reason: 'a file is not in the record',
    })
    fs.rmSync(path.join(published, 'extra.txt'))

    const junit = path.join(published, 'junit.xml')
    const bytes = fs.readFileSync(junit)
    bytes.writeUInt8(bytes.readUInt8(0) ^ 1, 0)
    fs.writeFileSync(junit, bytes)
    expect(verifyArtifacts(directory)).toEqual({
      ok: false,
      reason: 'a file changed after finalization',
    })

    fs.rmSync(junit)
    expect(verifyArtifacts(directory)).toEqual({
      ok: false,
      reason: 'a recorded file is missing',
    })
    expect(verifyCli()).toBe(1)
  })

  it('R54-AR-04 starts every run with nothing an earlier run could upload', () => {
    writeFailingRun()
    finalize()
    expect(verifyArtifacts(directory).ok).toBe(true)

    resetArtifacts(directory)

    for (const entry of [COMPLETION_RECORD, ISSUED_OTPS_FILE, ARTIFACTS_DIR])
      expect(fs.existsSync(path.join(directory, entry))).toBe(false)
    expect(fs.readdirSync(path.join(directory, RAW_DIR))).toEqual([])
    expect(verifyArtifacts(directory).ok).toBe(false)
  })

  it('R54-AR-05 the scan still catches a code or JWT that reached the published set', () => {
    writeFailingRun()
    finalize((text) => text)

    expect(verifyArtifacts(directory).ok).toBe(true)
    const { code, output } = scan()
    expect(code).toBe(1)
    expect(output).toContain('issued OTP #1')
    expect(output).toContain('a JWT-shaped value')
    expect(output).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(output).not.toContain(CODE)
    expect(output).not.toContain(JWT)
  })
})
