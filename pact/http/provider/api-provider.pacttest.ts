// Learning path Step 19: Scenario outfit generator.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-19-scenario-outfit-generator
// Learning path Step 20: Comfort calibration settings.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-20-comfort-calibration-settings
// Learning path Step 21: Reasoning badges and explanations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-21-reasoning-badges-and-explanations
// Learning path Step 22: Localization infrastructure and quality gates.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-22-localization-infrastructure-and-quality-gates
// Learning path Step 30: Smart tagging and comfort metadata.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-30-smart-tagging-and-comfort-metadata
// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
// Learning path Step 32: Wardrobe onboarding and silhouette setup.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-32-wardrobe-onboarding-and-silhouette-setup
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import 'reflect-metadata'
import path from 'node:path'
import { Verifier } from '@pact-foundation/pact'
import type { VerifierOptions } from '@pact-foundation/pact'
import { buildVerifierOptions } from '@seontechnologies/pactjs-utils'
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetProviderState, startLocalPactProvider } from './provider-helper'
import { stateHandlers } from './state-handlers'

const artifactsDir = path.resolve(process.cwd(), 'pact/artifacts')
const pactFiles = [
  path.resolve(process.cwd(), 'pacts/CoutureCastWeb-CoutureCastApi.json'),
  path.resolve(process.cwd(), 'pacts/CoutureCastMobile-CoutureCastApi.json'),
]

describe('CoutureCastApi provider contract verification', () => {
  let app: INestApplication | undefined
  let providerBaseUrl = ''

  beforeAll(async () => {
    const provider = await startLocalPactProvider({ artifactsDir, pactFiles })
    app = provider.app
    providerBaseUrl = provider.providerBaseUrl
  })

  afterAll(async () => {
    if (app) {
      await app.close()
      app = undefined
    }
  })

  it('satisfies the local web and mobile consumer pacts', async () => {
    const port = new URL(providerBaseUrl).port
    const options: VerifierOptions = buildVerifierOptions({
      provider: 'CoutureCastApi',
      port,
      stateHandlers,
      beforeEach: () => {
        resetProviderState()
        return Promise.resolve()
      },
      afterEach: () => {
        resetProviderState()
        return Promise.resolve()
      },
      pactUrls: pactFiles,
      includeMainAndDeployed: true,
      publishVerificationResult: false,
      logLevel: 'warn',
      providerVersion: process.env.GITHUB_SHA || 'local',
      providerVersionBranch:
        process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'local',
    })

    const verifier = new Verifier({
      ...options,
      providerBaseUrl,
      logFile: path.join(artifactsDir, 'provider-verification.log'),
    })

    await expect(verifier.verifyProvider()).resolves.toBeTruthy()
  })
})
