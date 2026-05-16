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
