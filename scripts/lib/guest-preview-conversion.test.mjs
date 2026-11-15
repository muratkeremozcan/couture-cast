// Story 6.16 E-CONV-REAL-STACK: the runner side of the mobile guest conversion. Running
// run-maestro.mjs rebuilds shared packages at import, so its wiring is read from source; the
// helpers below carry the behavior.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { IDENTITIES_FILE, readIdentities } from '../e2e-real-session/identities.mjs'
import {
  GUEST_CONVERSION_FLOW,
  GUEST_CONVERSION_PROPOSAL,
  GUEST_CONVERSION_VERIFY_FLOW,
  GUEST_EMAIL,
  cleanupGuestAccounts,
  comfortMismatch,
  deviceSupabaseUrl,
  guestConversionEmail,
  publishRedacted,
  readMailpitCode,
  recordGuestAccount,
  recordIssuedCode,
  resolveGuestStateDir,
  resolveLocalSupabase,
  runGuestConversionLeg,
  runPrivateMaestro,
  startIssuedCodeFile,
} from './guest-preview-conversion.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const runner = fs.readFileSync(path.join(root, 'scripts/run-maestro.mjs'), 'utf8')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-conversion-test-'))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))
const fresh = (name) => fs.mkdtempSync(path.join(scratch, `${name}-`))

const uuid = () => '0f8f2c1e-3b4d-4c5e-9a6b-7c8d9e0f1a2b'
const EMAIL = guestConversionEmail(uuid)
const CODE = '482913'

describe('guest accounts are recorded write-ahead', () => {
  test('the synthetic address is the only shape recorded', () => {
    assert.equal(EMAIL, 'mobile-guest-0f8f2c1e-3b4d-4c5e-9a6b-7c8d9e0f1a2b@example.test')
    assert.match(guestConversionEmail(), GUEST_EMAIL)
    const directory = path.join(fresh('record'), 'state')
    recordGuestAccount(directory, EMAIL)
    assert.deepEqual(readIdentities(directory), [
      { email: EMAIL, label: 'guest-conversion', pending: true },
    ])
    assert.equal(fs.statSync(path.join(directory, IDENTITIES_FILE)).mode & 0o777, 0o600)
    assert.throws(
      () => recordGuestAccount(directory, 'someone@example.com'),
      /Refusing to record an address outside/
    )
    assert.equal(readIdentities(directory).length, 1)
  })

  test('the state directory defaults under the repository and follows the env', () => {
    assert.equal(resolveGuestStateDir({}, '/repo'), '/repo/.maestro-guest-preview')
    assert.equal(
      resolveGuestStateDir({ MOBILE_E2E_GUEST_STATE_DIR: '/tmp/guest' }, '/repo'),
      '/tmp/guest'
    )
    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    assert.match(ignore, /^\.maestro-guest-preview\/$/m)
  })
})

describe('issued sign-in codes are listed for the artifact scan', () => {
  test('the list starts empty and private, and appends each code', () => {
    const file = path.join(fresh('otp'), 'nested', 'otps.json')
    startIssuedCodeFile(file)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [])
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    recordIssuedCode(file, CODE)
    recordIssuedCode(file, '000111')
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [CODE, '000111'])
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  })

  test('with no file configured nothing is written', () => {
    assert.doesNotThrow(() => startIssuedCodeFile(undefined))
    assert.doesNotThrow(() => recordIssuedCode(undefined, CODE))
  })
})

/** A Mailpit double: `pages[i]` is what the i-th list request answers. */
function mailpit(pages, bodies) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('/api/v1/messages?')) {
      const page =
        pages[Math.min(calls.filter((c) => c.includes('?')).length - 1, pages.length - 1)]
      if (page instanceof Error) throw page
      return new Response(JSON.stringify({ messages: page }))
    }
    const id = url.split('/').at(-1)
    return new Response(JSON.stringify(bodies[id]))
  }
  return { fetchImpl, calls }
}

const message = (ID, address, created) => ({
  ID,
  To: [{ Address: address }],
  Created: new Date(created).toISOString(),
})

describe('readMailpitCode', () => {
  const since = Date.parse('2026-11-15T12:00:00Z')
  const clock = () => {
    let now = since
    return { now: () => now, sleep: async (ms) => void (now += ms) }
  }

  test('reads the newest code sent to the guest after the request, polling until it arrives', async () => {
    const { fetchImpl, calls } = mailpit(
      [
        [],
        [
          message('other', 'someone@example.test', since + 2_000),
          message('old', EMAIL, since - 60_000),
          message('first', EMAIL.toUpperCase(), since + 1_000),
          message('newest', EMAIL, since + 3_000),
        ],
      ],
      {
        other: { Text: 'Your code is 111111' },
        old: { Text: 'Your code is 222222' },
        first: { Text: 'Your code is 333333' },
        newest: { Text: `Enter the code: ${CODE}`, HTML: '' },
      }
    )
    const code = await readMailpitCode({
      mailpitUrl: 'http://127.0.0.1:54324',
      email: EMAIL,
      sinceMs: since,
      fetchImpl,
      ...clock(),
    })
    assert.equal(code, CODE)
    assert.equal(calls[0], 'http://127.0.0.1:54324/api/v1/messages?limit=50')
    assert.equal(calls.includes('http://127.0.0.1:54324/api/v1/message/other'), false)
    assert.equal(calls.includes('http://127.0.0.1:54324/api/v1/message/old'), false)
  })

  test('a Mailpit error is retried until the deadline', async () => {
    const { fetchImpl } = mailpit(
      [new Error('connect ECONNREFUSED'), [message('m', EMAIL, since + 500)]],
      { m: { Text: `code ${CODE}` } }
    )
    assert.equal(
      await readMailpitCode({
        mailpitUrl: 'http://mail',
        email: EMAIL,
        sinceMs: since,
        fetchImpl,
        ...clock(),
      }),
      CODE
    )
  })

  test('no code by the deadline fails, naming the last error and no code', async () => {
    const { fetchImpl, calls } = mailpit([[message('m', EMAIL, since - 10_000)]], {
      m: { Text: `code ${CODE}` },
    })
    await assert.rejects(
      readMailpitCode({
        mailpitUrl: 'http://mail',
        email: EMAIL,
        sinceMs: since,
        fetchImpl,
        timeoutMs: 5_000,
        intervalMs: 1_000,
        ...clock(),
      }),
      (error) =>
        /No sign-in code reached Mailpit at http:\/\/mail for the guest address within 5 s\./.test(
          error.message
        ) && !error.message.includes(CODE)
    )
    assert.equal(calls.length, 6)
    const failing = mailpit([new Error('Mailpit answered 503')], {})
    await assert.rejects(
      readMailpitCode({
        mailpitUrl: 'http://mail',
        email: EMAIL,
        sinceMs: since,
        fetchImpl: failing.fetchImpl,
        timeoutMs: 1_000,
        ...clock(),
      }),
      /last error: Mailpit answered 503/
    )
  })
})

describe('helpers mirrored from the real-session harness', () => {
  test('code extraction, redaction and loopback checks match harness.mjs', async () => {
    const harness = await import('../e2e-real-session/harness.mjs')
    const local = await import('./guest-preview-conversion.mjs')
    for (const body of [
      `Enter the code: ${CODE}`,
      'year 2026 only',
      'code 1234567890 and 111111',
    ])
      assert.equal(local.extractSignInCode(body), harness.extractMailCode(body), body)
    const text = `typed ${CODE} with eyJabc.def.ghi`
    assert.equal(local.redactSecrets(text, [CODE]), harness.redactSecrets(text, [CODE]))
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', 'x.supabase.co'])
      assert.equal(local.isLoopbackHost(host), harness.isLoopbackHost(host), host)
  })
})

describe('comfortMismatch', () => {
  test('the proposal is cold, low, high', () => {
    assert.deepEqual(GUEST_CONVERSION_PROPOSAL, {
      runs_cold_warm: 'cold',
      wind_tolerance: 'low',
      precip_preparedness: 'high',
    })
  })

  test('an equal row passes; a missing or different row is named', () => {
    assert.equal(comfortMismatch({ ...GUEST_CONVERSION_PROPOSAL, id: 'x' }), undefined)
    assert.equal(
      comfortMismatch(null),
      'no comfort preferences row exists for the converted account'
    )
    assert.equal(
      comfortMismatch({ ...GUEST_CONVERSION_PROPOSAL, wind_tolerance: 'medium' }),
      'the saved comfort row is not the proposal: wind_tolerance is medium, expected low'
    )
  })
})

describe('runGuestConversionLeg', () => {
  const steps = (events, overrides = {}) => ({
    readCode: async () => {
      events.push('read')
      return CODE
    },
    recordCode: (code) => events.push(`record ${code}`),
    runVerifyFlow: async (code) => events.push(`verify ${code}`),
    verifyComfort: async () => {
      events.push('comfort')
      return undefined
    },
    ...overrides,
  })

  test('reads, lists the code before any flow sees it, verifies, then checks the row', async () => {
    const events = []
    assert.equal(await runGuestConversionLeg(steps(events)), undefined)
    assert.deepEqual(events, ['read', `record ${CODE}`, `verify ${CODE}`, 'comfort'])
  })

  test('a code that cannot be listed is never used', async () => {
    const events = []
    const cause = await runGuestConversionLeg(
      steps(events, {
        recordCode: () => {
          throw new Error(`disk full writing ${CODE}`)
        },
      })
    )
    assert.deepEqual(events, ['read'])
    assert.match(cause, /could not be listed for the artifact scan, so it was not used/)
    assert.equal(cause.includes(CODE), false)
  })

  test('each failure becomes the cause, with the code redacted', async () => {
    assert.equal(
      await runGuestConversionLeg(
        steps([], {
          readCode: async () => {
            throw new Error('No sign-in code reached Mailpit')
          },
        })
      ),
      'No sign-in code reached Mailpit'
    )
    const verify = await runGuestConversionLeg(
      steps([], {
        runVerifyFlow: async (code) => {
          throw new Error(`Element not found: ${code}`)
        },
      })
    )
    assert.equal(verify, 'the sign-in verify step failed: Element not found: [REDACTED]')
    assert.equal(
      await runGuestConversionLeg(
        steps([], { verifyComfort: async () => 'row differs' })
      ),
      'row differs'
    )
    assert.match(
      await runGuestConversionLeg(
        steps([], {
          verifyComfort: async () => {
            throw new Error('db down')
          },
        })
      ),
      /the saved comfort row could not be read: db down/
    )
  })
})

describe('runPrivateMaestro', () => {
  const directory = fresh('maestro')
  const fake = path.join(directory, 'fake-maestro.mjs')
  fs.writeFileSync(
    fake,
    `console.log('argv ' + process.argv.slice(2).join(' '))
console.log('Input text ' + process.env.MAESTRO_OTP)
process.exit(Number(process.env.FAKE_EXIT ?? 0))
`
  )
  const capture = async (work) => {
    const written = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk, ...rest) => {
      written.push(String(chunk))
      return original(chunk, ...rest)
    }
    try {
      return { result: await work(), written: written.join('') }
    } finally {
      process.stdout.write = original
    }
  }

  test('the code travels in env only, the output is never echoed and its log is redacted', async () => {
    const logFile = path.join(directory, 'out', 'verify.log')
    const { written } = await capture(() =>
      runPrivateMaestro({
        commands: [[path.join(directory, 'missing-maestro')], [process.execPath, fake]],
        args: ['test', 'flow.yaml'],
        env: { ...process.env, MAESTRO_OTP: CODE },
        secrets: [CODE],
        timeoutMs: 10_000,
        logFile,
      })
    )
    assert.equal(written.includes(CODE), false)
    assert.equal(written.includes('Input text'), false)
    const logged = fs.readFileSync(logFile, 'utf8')
    assert.match(logged, /argv test flow\.yaml/)
    assert.match(logged, /Input text \[REDACTED\]/)
    assert.equal(logged.includes(CODE), false)
  })

  test('a failing run names only its exit, and a missing Maestro is named', async () => {
    await assert.rejects(
      runPrivateMaestro({
        commands: [[process.execPath, fake]],
        args: [],
        env: { ...process.env, MAESTRO_OTP: CODE, FAKE_EXIT: '3' },
        secrets: [CODE],
        timeoutMs: 10_000,
      }),
      (error) =>
        error.message.endsWith('exited with code 3') && !error.message.includes(CODE)
    )
    await assert.rejects(
      runPrivateMaestro({
        commands: [[path.join(directory, 'missing-maestro')]],
        args: [],
        env: process.env,
        secrets: [],
        timeoutMs: 10_000,
      }),
      /No Maestro command was found/
    )
  })

  test('publishRedacted copies a report without the code and skips a missing one', () => {
    const from = path.join(directory, 'report.xml')
    fs.writeFileSync(from, `<failure>typed ${CODE}</failure>`)
    const to = path.join(directory, 'artifacts', 'report.xml')
    publishRedacted(from, to, [CODE])
    assert.equal(fs.readFileSync(to, 'utf8'), '<failure>typed [REDACTED]</failure>')
    publishRedacted(path.join(directory, 'none.xml'), path.join(directory, 'x.xml'), [
      CODE,
    ])
    assert.equal(fs.existsSync(path.join(directory, 'x.xml')), false)
  })
})

describe('cleanupGuestAccounts', () => {
  const second = guestConversionEmail(() => '1f8f2c1e-3b4d-4c5e-9a6b-7c8d9e0f1a2b')

  test('deletes the app user then the Auth user of each address and drops settled rows', async () => {
    const directory = fresh('cleanup')
    recordGuestAccount(directory, EMAIL)
    recordGuestAccount(directory, second)
    const events = []
    const summary = await cleanupGuestAccounts({
      directory,
      deleteAppUser: async (email) => events.push(`app ${email}`),
      deleteAuthUser: async (email) => {
        events.push(`auth ${email}`)
        if (email === second) throw new Error('Auth user delete failed: 500')
      },
    })
    assert.deepEqual(events, [
      `app ${EMAIL}`,
      `auth ${EMAIL}`,
      `app ${second}`,
      `auth ${second}`,
    ])
    assert.deepEqual(summary, {
      recorded: 2,
      settled: 1,
      failed: [`${second}: Auth user delete failed: 500`],
    })
    assert.deepEqual(
      readIdentities(directory).map((row) => row.email),
      [second]
    )
  })

  test('a row of any other address refuses the whole cleanup', async () => {
    const directory = fresh('refuse')
    recordGuestAccount(directory, EMAIL)
    fs.writeFileSync(
      path.join(directory, IDENTITIES_FILE),
      JSON.stringify([
        ...readIdentities(directory),
        { email: 'owner@example.com', pending: true },
      ])
    )
    const events = []
    await assert.rejects(
      cleanupGuestAccounts({
        directory,
        deleteAppUser: async (email) => events.push(email),
        deleteAuthUser: async (email) => events.push(email),
      }),
      /Refusing guest cleanup: 1 recorded row\(s\) are not guest preview addresses/
    )
    assert.deepEqual(events, [])
  })

  test('nothing recorded is nothing to do', async () => {
    assert.deepEqual(
      await cleanupGuestAccounts({
        directory: path.join(scratch, 'never-created'),
        deleteAppUser: async () => assert.fail('no app delete'),
        deleteAuthUser: async () => assert.fail('no auth delete'),
      }),
      { recorded: 0, settled: 0, failed: [] }
    )
  })
})

describe('local Supabase', () => {
  const local = {
    SUPABASE_URL: 'http://127.0.0.1:24321',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  }

  test('the exported environment wins and status is read only when a key is missing', () => {
    assert.deepEqual(
      resolveLocalSupabase(local, () => assert.fail('status read')),
      { url: local.SUPABASE_URL, anonKey: 'anon', serviceRoleKey: 'service' }
    )
    assert.deepEqual(
      resolveLocalSupabase({}, () => ({
        API_URL: 'http://127.0.0.1:54321',
        ANON_KEY: 'a',
        SERVICE_ROLE_KEY: 's',
      })),
      { url: 'http://127.0.0.1:54321', anonKey: 'a', serviceRoleKey: 's' }
    )
  })

  test('a remote or incomplete Supabase is refused', () => {
    assert.throws(
      () =>
        resolveLocalSupabase(
          { ...local, SUPABASE_URL: 'https://x.supabase.co' },
          () => ({})
        ),
      /must point at the local Supabase/
    )
    assert.throws(() => resolveLocalSupabase({}, () => ({})), /could not be resolved/)
  })

  test('the device reaches Supabase through the bundle host', () => {
    assert.equal(
      deviceSupabaseUrl('http://127.0.0.1:24321', '10.0.2.2'),
      'http://10.0.2.2:24321'
    )
    assert.equal(
      deviceSupabaseUrl('http://127.0.0.1:54321/', '127.0.0.1'),
      'http://127.0.0.1:54321'
    )
  })
})

describe('run-maestro.mjs wiring', () => {
  const at = (text, needle, from = 0) => {
    const index = text.indexOf(needle, from)
    assert.notEqual(index, -1, needle)
    return index
  }
  const body = (name) => {
    const start = at(runner, `const ${name} = `)
    return runner.slice(start, runner.indexOf('\n}\n', start))
  }

  test('the conversion flow records its address before Maestro runs, and the leg runs after its outcome', () => {
    const serial = body('runFlowsSerially')
    const begin = at(
      serial,
      'const conversion = beginGuestConversion(flowPath, target, maestroEnv)'
    )
    assert.ok(begin < at(serial, 'await runMaestroCommandWithWatchdogRetry('))
    const outcome = at(serial, 'recordSingleFlowOutcome(')
    const finish = at(serial, 'await conversion?.finish(flowPasses.has(flowPath))')
    assert.ok(finish > outcome)
    assert.match(
      serial,
      /for \(const cause of \[doubleCause, restoreCause, conversionCause\]\)/
    )
    const leg = body('beginGuestConversion')
    assert.ok(
      at(leg, 'recordGuestAccount(guestConversion.stateDir, email)') <
        at(leg, 'const sinceMs = Date.now()')
    )
    assert.equal(GUEST_CONVERSION_FLOW, 'maestro/guest-preview-conversion.yaml')
  })

  test('the code reaches only the verify child env and no shared Maestro argument', () => {
    assert.equal(body('buildMaestroFlowEnvArgs').includes('MAESTRO_OTP'), false)
    assert.match(
      body('buildMaestroFlowEnvArgs'),
      /GUEST_PREVIEW_EMAIL=\$\{process\.env\.GUEST_PREVIEW_EMAIL \?\? ''\}/
    )
    const code = runner
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/)/.test(line) && line.includes('MAESTRO_OTP'))
    assert.deepEqual(code, ['        env: { ...maestroEnv, MAESTRO_OTP: code },'])
    const verify = body('runGuestVerifyFlow')
    assert.match(verify, /env: \{ \.\.\.maestroEnv, MAESTRO_OTP: code \}/)
    assert.match(
      verify,
      /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'guest-preview-verify-'\)\)/
    )
    assert.match(verify, /fs\.rmSync\(privateDir, \{ recursive: true, force: true \}\)/)
    assert.match(
      verify,
      /maestroFlowPath\(GUEST_CONVERSION_VERIFY_FLOW, target\.platform\)/
    )
    assert.equal(
      GUEST_CONVERSION_VERIFY_FLOW,
      'maestro/guest-preview/guest-preview-conversion-verify.yaml'
    )
  })

  test('the stack is pointed at local Supabase before the API starts, and cleanup runs before it stops', () => {
    const run = body('run')
    assert.ok(
      at(run, 'await prepareSignedOutStack(target.platform)') <
        at(run, 'await startOrReuseLocalApi(children')
    )
    const prepare = body('prepareSignedOutStack')
    assert.ok(
      at(prepare, 'startIssuedCodeFile(guestConversion.otpFile)') <
        at(prepare, 'resolveLocalSupabase(')
    )
    assert.match(prepare, /flowRefusals\.set\(GUEST_CONVERSION_FLOW, cause\)/)
    assert.equal(prepare.includes('process.env.SUPABASE_SERVICE_ROLE_KEY ='), false)
    const cleanup = body('cleanupMobileRun')
    assert.ok(
      at(
        cleanup,
        'if (SIGNED_OUT) await cleanupGuestConversionAccounts(apiSetupBaseUrl)'
      ) < at(cleanup, 'processCleanup')
    )
  })
})
