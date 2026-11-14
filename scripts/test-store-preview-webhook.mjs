#!/usr/bin/env node
// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15 (TEA-18): the preview webhook leg, for the operator. It makes nothing on Vercel
// or RevenueCat; it prints the steps, probes the configured route, and verifies a journey run's
// webhook delivery through the preview API's own read endpoints.
//
//   node scripts/test-store-preview-webhook.mjs steps --api-url <preview API origin>
//   node scripts/test-store-preview-webhook.mjs probe --api-url <origin> [--secrets-env .env.preview]
//   node scripts/test-store-preview-webhook.mjs verify --report <run-test-store-journey report> \
//     --member-file <out>.private/<label>.member.json \
//     --api-url <origin> [--secrets-env .env.preview]
//
// `probe` reads REVENUECAT_TEST_STORE_WEBHOOK_BYPASS_SECRET from the env file by name and sends
// two unauthenticated POSTs through it; both must get the handler's own 401. `verify` re-reads
// the run's member on GET subscription and GET premium/access (Vercel's read bypass header from
// VERCEL_AUTOMATION_BYPASS_SECRET) and checks, from the run's proxy log, that no refresh reached
// the API after the purchase began, so the entitlement came by webhook. No value is printed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMobileE2EAccessToken } from './lib/mobile-e2e-token.mjs'
import { journeyApi, requireEnvValue, serverState } from './lib/test-store-api.mjs'
import { verifyWebhookDelivery } from './lib/test-store-runner.mjs'
import {
  READ_BYPASS_ENV,
  WEBHOOK_BYPASS_ENV,
  operatorSteps,
  probeWebhook,
} from './lib/test-store-webhook.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [command, ...argv] = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at < 0 ? fallback : argv[at + 1]
}
const apiUrl = option('api-url')
const envFile = path.resolve(option('secrets-env', path.join(root, '.env.preview')))

try {
  if (!apiUrl)
    throw new Error('usage: <steps|probe|verify> --api-url <preview API origin>')
  if (command === 'steps') console.log(operatorSteps(apiUrl).join('\n'))
  else if (command === 'probe') {
    const record = await probeWebhook({
      apiOrigin: apiUrl,
      secret: requireEnvValue(envFile, WEBHOOK_BYPASS_ENV),
    })
    console.log(JSON.stringify(record, null, 2))
  } else if (command === 'verify') {
    const report = JSON.parse(fs.readFileSync(option('report'), 'utf8'))
    const api = journeyApi({
      origin: apiUrl,
      headers: {
        'x-vercel-protection-bypass': requireEnvValue(envFile, READ_BYPASS_ENV),
      },
    })
    const { userId } = JSON.parse(fs.readFileSync(option('member-file'), 'utf8'))
    const state = await serverState(api, buildMobileE2EAccessToken(userId))
    console.log(JSON.stringify(verifyWebhookDelivery({ report, state, userId }), null, 2))
  } else throw new Error(`unknown command: ${command}`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
