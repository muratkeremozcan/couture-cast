// Learning path Step 6: Realtime and push delivery.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-6-realtime-and-push-delivery
// Learning path Step 19: Scenario outfit generator.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-19-scenario-outfit-generator
// Learning path Step 20: Comfort calibration settings.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-20-comfort-calibration-settings
// Learning path Step 21: Reasoning badges and explanations.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-21-reasoning-badges-and-explanations
// Learning path Step 31: Outfit capsule builder.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-31-outfit-capsule-builder
// Learning path Step 33: Affiliate "Shop this look" CTA.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-33-affiliate-shop-this-look-cta
import { applyEnvOverrides, getConfig, getScenarioConfig } from '@couture/k6-utils/config'
import { handleSummary } from '@couture/k6-utils/handle-summary'
import { BASE_URL, infraDelay, SLO, TEST_ENV } from '../helpers/config'

import {
  testComfortPreferences,
  testGuardianWritePath,
  testProfileAndModeration,
} from '../scenarios/auth.scenarios'
import {
  testCapsuleColdRitual,
  testCapsuleReadPaths,
  testCapsuleWritePaths,
} from '../scenarios/capsules.scenarios'
import {
  testApiHealth,
  testQueueHealth,
  testRealtimePoll,
} from '../scenarios/health.scenarios'
import { testSubscriptionStatus } from '../scenarios/premium.scenarios'
import {
  testRitualCommerceEligible,
  testRitualOutfits,
} from '../scenarios/ritual.scenarios'

export {
  handleSummary,
  testApiHealth,
  testRealtimePoll,
  testQueueHealth,
  testGuardianWritePath,
  testProfileAndModeration,
  testRitualOutfits,
  testComfortPreferences,
  testCapsuleReadPaths,
  testCapsuleWritePaths,
  testCapsuleColdRitual,
  testRitualCommerceEligible,
  testSubscriptionStatus,
}

const scenarioNames = [
  'testApiHealth',
  'testRealtimePoll',
  'testQueueHealth',
  'testGuardianWritePath',
  'testProfileAndModeration',
  'testRitualOutfits',
  'testComfortPreferences',
  'testCapsuleReadPaths',
  'testCapsuleWritePaths',
  'testCapsuleColdRitual',
  'testRitualCommerceEligible',
  'testSubscriptionStatus',
]

export const options = {
  ...getScenarioConfig(scenarioNames, applyEnvOverrides(getConfig())),
  thresholds: {
    http_req_duration: [`p(95)<${SLO.aggregate + infraDelay}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.95'],
    'http_req_duration{name:api/health}': [`p(95)<${SLO.health + infraDelay}`],
    'http_req_duration{name:api/events-poll}': [`p(95)<${SLO.eventsPoll + infraDelay}`],
    'http_req_duration{name:api/queue-health}': [`p(95)<${SLO.queueHealth + infraDelay}`],
    'http_req_duration{name:auth/signup}': [`p(95)<${SLO.signup + infraDelay}`],
    'http_req_duration{name:guardian/invitations}': [
      `p(95)<${SLO.guardianInvite + infraDelay}`,
    ],
    'http_req_duration{name:guardian/accept}': [
      `p(95)<${SLO.guardianAccept + infraDelay}`,
    ],
    'http_req_duration{name:guardian/revoke}': [
      `p(95)<${SLO.guardianRevoke + infraDelay}`,
    ],
    'http_req_duration{name:user/profile}': [`p(95)<${SLO.userProfile + infraDelay}`],
    'http_req_duration{name:moderation/actions}': [
      `p(95)<${SLO.moderationAction + infraDelay}`,
    ],
    'http_req_duration{name:api/ritual}': [`p(95)<${SLO.eventsPoll + infraDelay}`],
    'http_req_duration{name:api/comfort-get}': [`p(95)<${SLO.userProfile + infraDelay}`],
    'http_req_duration{name:api/comfort-put}': [`p(95)<${SLO.userProfile + infraDelay}`],
    // Story 4.3 capsule endpoints, tagged individually so a regression is attributable.
    'http_req_duration{name:capsules/list}': [`p(95)<${SLO.capsuleRead + infraDelay}`],
    'http_req_duration{name:capsules/detail}': [`p(95)<${SLO.capsuleRead + infraDelay}`],
    'http_req_duration{name:capsules/search}': [`p(95)<${SLO.capsuleRead + infraDelay}`],
    'http_req_duration{name:capsules/create}': [`p(95)<${SLO.capsuleWrite + infraDelay}`],
    'http_req_duration{name:capsules/update}': [`p(95)<${SLO.capsuleWrite + infraDelay}`],
    'http_req_duration{name:capsules/favorite}': [
      `p(95)<${SLO.capsuleWrite + infraDelay}`,
    ],
    'http_req_duration{name:capsules/delete}': [`p(95)<${SLO.capsuleWrite + infraDelay}`],
    'http_req_duration{name:capsules/ritual-cold}': [
      `p(95)<${SLO.capsuleRitualCold + infraDelay}`,
    ],
    'http_req_failed{name:capsules/list}': ['rate<0.01'],
    'http_req_failed{name:capsules/detail}': ['rate<0.01'],
    'http_req_failed{name:capsules/search}': ['rate<0.01'],
    'http_req_failed{name:capsules/create}': ['rate<0.01'],
    'http_req_failed{name:capsules/update}': ['rate<0.01'],
    'http_req_failed{name:capsules/favorite}': ['rate<0.01'],
    'http_req_failed{name:capsules/delete}': ['rate<0.01'],
    'http_req_failed{name:capsules/ritual-cold}': ['rate<0.01'],
    // Story 5.1: the warm eligible ritual read, where the affiliate eligibility
    // chain is the marginal cost. Tagged on its own so a breach names commerce
    // rather than the ritual aggregate it shares a route with.
    'http_req_duration{name:api/ritual-eligible}': [
      `p(95)<${SLO.ritualEligible + infraDelay}`,
    ],
    'http_req_failed{name:api/ritual-eligible}': ['rate<0.01'],
    // Story 5.2: the subscription status read (local entitlement mirror plus
    // flag evaluation). Refresh has no threshold because it has no scenario:
    // it hits the RevenueCat ledger per call and stays out of load runs.
    'http_req_duration{name:api/subscription-status}': [
      `p(95)<${SLO.subscriptionStatus + infraDelay}`,
    ],
    'http_req_failed{name:api/subscription-status}': ['rate<0.01'],
  },
}

// When options.scenarios is set k6 dispatches to named exports below and ignores default.
// The default runs all scenarios in sequence — used as a fallback when running without
// TEST_CONFIG (e.g. k6 run dist/test.js --vus 1 --iterations 1).
export default function () {
  testApiHealth()
  testRealtimePoll()
  testQueueHealth()
  testGuardianWritePath()
  testProfileAndModeration()
  testRitualOutfits()
  testComfortPreferences()
}

export function setup() {
  console.log(`k6 target: ${BASE_URL} (TEST_ENV=${TEST_ENV})`)
  if (TEST_ENV !== 'local') {
    console.warn(
      `[write-path] Running against "${TEST_ENV}": testGuardianWritePath and testProfileAndModeration ` +
        'create user accounts and moderation records that are not cleaned up. ' +
        'Schedule periodic db:reset or scope write-path scenarios to local only if this accumulates.'
    )
  }
}
