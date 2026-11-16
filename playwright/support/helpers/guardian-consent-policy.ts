// Guardian consent is off in production (owner ruling 2026-11-16). The guardian consent flows
// stay proven for the day it returns: tests tagged @consent-required run in their own lane
// (`npm run test:pw-consent`), against an API started with GUARDIAN_CONSENT_POLICY=required_13_15,
// and skip in the default lane, whose API runs the shipped `off`. The Playwright process reads
// the same variable the stack it starts reads.
import {
  CONSENT_REQUIRED_TAG,
  realSessionConsentPolicy,
} from '../../../scripts/e2e-real-session/harness.mjs'

export { CONSENT_REQUIRED_TAG }

/** The policy the API under test runs. */
export const e2eConsentPolicy = () => realSessionConsentPolicy(process.env)

export const CONSENT_LANE_ONLY =
  'Runs in the guardian consent lane (npm run test:pw-consent, GUARDIAN_CONSENT_POLICY=required_13_15).'

export const CONSENT_OFF_ONLY =
  'The guardian consent lane runs the API with consent required.'
