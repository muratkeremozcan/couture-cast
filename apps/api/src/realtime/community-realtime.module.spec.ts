// TEA sign-off F-4: the realtime function refuses a guardian consent policy its deployment may
// not run, as AppModule does.
import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { describe, expect, it } from 'vitest'
import { guardianConsentPolicyBootCheck } from '../modules/auth/guardian-consent-policy.js'
import { CommunityRealtimeModule } from './community-realtime.module.js'

describe('U-RT-POLICY: CommunityRealtimeModule', () => {
  it('carries the guardian consent policy boot check', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CommunityRealtimeModule)
    ).toEqual([guardianConsentPolicyBootCheck])
  })

  it('is the context the realtime function starts', () => {
    const entry = readFileSync(path.resolve(__dirname, '../../api/realtime.ts'), 'utf8')
    expect(entry).toContain(
      'NestFactory.createApplicationContext(CommunityRealtimeModule,'
    )
    expect(entry).toContain(
      "import { CommunityRealtimeModule } from '../src/realtime/community-realtime.module.js'"
    )
  })
})
