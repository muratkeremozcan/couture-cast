/*
 * Records the repository owner's verdict on the community screening readiness
 * evidence, bound to the payload's SHA-256, and verifies a recorded signature.
 *
 * Story 6.2b, AC 6 and Decision 5. One honest signature against an immutable
 * hash: three role signatures from one person would not be three reviews. The
 * signature file carries the payload hash it was made against, so regenerating
 * the payload, which changes its hash, makes the signature stale; that staleness
 * is the property that makes a signature worth having.
 *
 * SIGNING IS INTERACTIVE AND HUMAN BY DESIGN. It prints the payload hash and its
 * verdict, asks the owner to type the first twelve characters of the hash, and
 * asks for their verdict. It refuses to run without a terminal, under CI, or
 * inside a recognised coding-agent session. No script or test in this
 * repository runs it, and no signature file is committed by the story that
 * added it. An owner may approve only a payload whose own verdict is `pass`; a
 * rejection can be recorded against any payload.
 *
 * DELEGATED MODE. `--delegated` records an approval the owner delegated to an
 * agent session, for the case where the owner has read the evidence and asked an
 * agent to record the result. It may run without a terminal and inside an agent
 * session, but it is still refused under CI, it is still refused unless the
 * payload's own verdict is `pass` and the generator's rule, rerun over the
 * payload's gates, also gives `pass`, and it can only record an approval. The record
 * says `mode: "delegated-by-owner"` beside the verdict and the payload hash, and
 * carries no name, statement or note, so nothing in it can read as the owner's
 * own words.
 *
 * Usage:
 *   npm run community:screening:sign                 (interactive)
 *   npm run community:screening:sign -- --delegated  (delegated by the owner)
 *   npm run community:screening:verify-signature     (node ... --verify)
 *
 * The verify command exits 0 only for a current signature that approves; a
 * missing, stale or rejecting signature exits nonzero.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verdictOf } from './generate-community-screening-readiness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const PAYLOAD =
  '_bmad-output/test-artifacts/community-content-screening-model-readiness.json'
const SIGNATURE = '_bmad-output/test-artifacts/community-content-screening-signature.json'
const HASH_PREFIX_LENGTH = 12

/**
 * Environment markers of a non-human caller. Best effort, on top of the TTY and
 * typed-hash requirements: an agent can allocate a pseudo-terminal, so the typed
 * prefix and the explicit statement are the real control, and this list only
 * turns the common accidental case into a refusal with a clear message.
 */
const NON_HUMAN_MARKERS = [
  'CI',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CODEX_SANDBOX',
  'GITHUB_ACTIONS',
]

export function payloadDigest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** valid, stale, or missing, with the hashes that decided it. */
export function assessSignature(payloadBytes, signature) {
  if (!payloadBytes) return { status: 'missing-payload' }
  const current = payloadDigest(payloadBytes)
  if (!signature) return { status: 'unsigned', payloadSha256: current }
  if (signature.payloadSha256 !== current) {
    return {
      status: 'stale',
      payloadSha256: current,
      signedPayloadSha256: signature.payloadSha256,
      signedAt: signature.signedAt,
    }
  }
  return {
    status: 'valid',
    mode: signature.mode ?? 'interactive-owner',
    payloadSha256: current,
    ownerVerdict: signature.ownerVerdict,
    signer: signature.signer,
    signedAt: signature.signedAt,
  }
}

function readIfPresent(relativePath) {
  const filePath = path.join(projectRoot, relativePath)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
}

function verify() {
  const payloadBytes = readIfPresent(PAYLOAD)
  const signatureBytes = readIfPresent(SIGNATURE)
  const signature = signatureBytes ? JSON.parse(signatureBytes.toString('utf8')) : null
  const result = assessSignature(payloadBytes, signature)
  console.log(JSON.stringify(result, null, 2))
  if (result.status === 'valid' && result.ownerVerdict !== 'approved') {
    console.error(
      `The signature is current but records ${result.ownerVerdict}, so the gate stays closed.`
    )
    process.exit(1)
  }
  if (result.status === 'valid') {
    console.log(
      `Signature is valid: ${result.ownerVerdict} (${result.mode}${result.signer ? `, ${result.signer}` : ''}) at ${result.signedAt}.`
    )
    process.exit(0)
  }
  if (result.status === 'stale') {
    console.error(
      'Signature is STALE: the payload changed after it was signed. Read the regenerated evidence and sign again.'
    )
  } else if (result.status === 'unsigned') {
    console.error('The payload has not been signed.')
  } else {
    console.error(`No payload at ${PAYLOAD}. Generate it first.`)
  }
  process.exit(1)
}

/**
 * Why signing must not proceed in this context, or null when it may. Pure, so
 * the refusal itself is tested without anything ever invoking the sign flow.
 */
/** Continuous-integration markers: delegated signing is refused under any of them. */
const CI_MARKERS = ['CI', 'GITHUB_ACTIONS']

export function signingRefusal({ stdinIsTTY, stdoutIsTTY, env, delegated = false }) {
  if (delegated) {
    const marker = CI_MARKERS.find((name) => (env[name] ?? '').trim() !== '')
    return marker
      ? `Delegated signing refuses to run with ${marker} set: a pipeline cannot record the owner's decision.`
      : null
  }
  if (!stdinIsTTY || !stdoutIsTTY) {
    return 'The sign command needs an interactive terminal. It records a human decision and cannot run piped or scripted.'
  }
  const marker = NON_HUMAN_MARKERS.find((name) => (env[name] ?? '').trim() !== '')
  if (marker) {
    return `The sign command refuses to run with ${marker} set: it records the repository owner's own decision, and generated code cannot sign on the owner's behalf.`
  }
  return null
}

/**
 * Why a payload cannot be approved, or null when it can. The stored verdict is
 * a field anyone can edit, so it is recomputed from the payload's own gates with
 * the generator's rule, and both must say `pass` (Story 6.2b final review, RF6).
 */
export function approvalRefusal(payload) {
  if (payload?.verdict !== 'pass') {
    return `The payload's own verdict is ${String(payload?.verdict)}. Only a passing payload can be approved.`
  }
  const recomputed = Array.isArray(payload.gates)
    ? verdictOf(payload.gates)
    : 'incomplete'
  if (recomputed !== payload.verdict) {
    return `The payload says pass, but its gates give ${recomputed}. The verdict does not match the gates, so the payload was edited after it was generated; regenerate it.`
  }
  return null
}

/**
 * The delegated record, or the reason it cannot be made. Only a passing payload
 * can be approved, by delegation or otherwise.
 */
export function delegatedSignature(payload, digest, now = new Date()) {
  const refusal = approvalRefusal(payload)
  if (refusal) {
    return { refusal: `${refusal} A delegated approval needs a passing payload.` }
  }
  return {
    record: {
      artifact: 'community-content-screening-signature',
      gate: 'Community Beta model readiness',
      mode: 'delegated-by-owner',
      payloadPath: PAYLOAD,
      payloadSha256: digest,
      payloadVerdict: payload.verdict,
      payloadGeneratedAt: payload.generatedAt,
      ownerVerdict: 'approved',
      signedAt: now.toISOString(),
    },
  }
}

function signDelegated() {
  const refusal = signingRefusal({
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    env: process.env,
    delegated: true,
  })
  if (refusal) {
    console.error(refusal)
    process.exit(2)
  }
  const payloadBytes = readIfPresent(PAYLOAD)
  if (!payloadBytes) {
    console.error(
      `No payload at ${PAYLOAD}. Run npm run community:screening:evidence first.`
    )
    process.exit(1)
  }
  const digest = payloadDigest(payloadBytes)
  const result = delegatedSignature(JSON.parse(payloadBytes.toString('utf8')), digest)
  if (result.refusal) {
    console.error(result.refusal)
    process.exit(1)
  }
  fs.writeFileSync(
    path.join(projectRoot, SIGNATURE),
    `${JSON.stringify(result.record, null, 2)}\n`
  )
  console.log(`Recorded a delegated-by-owner approval against ${digest} in ${SIGNATURE}.`)
}

function gitIdentity() {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim()
    const email = execFileSync('git', ['config', 'user.email'], {
      encoding: 'utf8',
    }).trim()
    return { name, email }
  } catch {
    return { name: null, email: null }
  }
}

async function sign() {
  const refusal = signingRefusal({
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    env: process.env,
  })
  if (refusal) {
    console.error(refusal)
    process.exit(2)
  }
  const payloadBytes = readIfPresent(PAYLOAD)
  if (!payloadBytes) {
    console.error(
      `No payload at ${PAYLOAD}. Run npm run community:screening:evidence first.`
    )
    process.exit(1)
  }
  const payload = JSON.parse(payloadBytes.toString('utf8'))
  const digest = payloadDigest(payloadBytes)
  const identity = gitIdentity()

  console.log(`Payload:          ${PAYLOAD}`)
  console.log(`Payload SHA-256:  ${digest}`)
  console.log(`Payload verdict:  ${payload.verdict}`)
  for (const entry of payload.gates ?? []) {
    console.log(`  ${String(entry.status).padEnd(8)} ${entry.name}`)
  }
  console.log('')
  console.log(
    'Read the rendered view first, in particular the limitations and the projected review load:'
  )
  console.log(`  ${PAYLOAD.replace(/\.json$/, '.md')}`)
  console.log('')

  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const typed = (
      await prompt.question(
        `Type the first ${HASH_PREFIX_LENGTH} characters of the payload SHA-256: `
      )
    ).trim()
    if (typed !== digest.slice(0, HASH_PREFIX_LENGTH)) {
      console.error('That does not match the payload hash. Nothing was recorded.')
      process.exit(1)
    }
    const choice = (await prompt.question('Your verdict, approve or reject: '))
      .trim()
      .toLowerCase()
    if (choice !== 'approve' && choice !== 'reject') {
      console.error('The verdict must be approve or reject. Nothing was recorded.')
      process.exit(1)
    }
    const refusal = choice === 'approve' ? approvalRefusal(payload) : null
    if (refusal) {
      console.error(
        `${refusal} Record a rejection, or regenerate the evidence once every gate passes.`
      )
      process.exit(1)
    }
    const name =
      (await prompt.question(`Your name [${identity.name ?? 'required'}]: `)).trim() ||
      identity.name
    if (!name) {
      console.error('A name is required. Nothing was recorded.')
      process.exit(1)
    }
    const note = (await prompt.question('Optional note for the record: ')).trim()

    const record = {
      artifact: 'community-content-screening-signature',
      gate: 'Community Beta model readiness',
      payloadPath: PAYLOAD,
      payloadSha256: digest,
      payloadVerdict: payload.verdict,
      payloadGeneratedAt: payload.generatedAt,
      ownerVerdict: choice === 'approve' ? 'approved' : 'rejected',
      signer: name,
      signerEmail: identity.email,
      signedAt: new Date().toISOString(),
      statement:
        'I read the evidence this hash identifies, including its limitations and projected review load, and this is my decision on the model-readiness gate only. It is not a Community Beta launch decision.',
      ...(note ? { note } : {}),
    }
    fs.writeFileSync(
      path.join(projectRoot, SIGNATURE),
      `${JSON.stringify(record, null, 2)}\n`
    )
    console.log(`Recorded ${record.ownerVerdict} against ${digest} in ${SIGNATURE}.`)
  } finally {
    prompt.close()
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  if (process.argv.includes('--verify')) verify()
  else if (process.argv.includes('--delegated')) signDelegated()
  else
    sign().catch((error) => {
      console.error('Signing error:', error)
      process.exit(1)
    })
}
