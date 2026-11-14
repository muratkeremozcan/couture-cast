// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// Story 6.15 D15: runs the Test Store journey's steps in order against an `io` object, so the
// same sequence drives a device (scripts/run-test-store-journey.mjs) and node tests (fakes).
// Each step yields one evidence record naming its server leg and delivery path (TEA-18); the
// first failing step ends the run, since every later step stands on it.
//
// `io` is:
//   preflight()         -> { userId, token, ledger } after the unpaid and plain-member checks
//   launch()            opens the installed app on the journey's Metro
//   flow(name)          runs maestro/test-store/<name>.yaml; throws on a failed step
//   hierarchy()         the device's view hierarchy as text
//   serverState()       -> { subscription, access } for the member
//   waitForPaid()       -> state once assertServerPaid holds (the webhook may lag the UI)
//   setPolicy(name)     the proxy's refresh policy (forward, block, block-once)
//   proxyLog()          the proxy's request log
//   minifiedEvidence()  the S4-15 build record (minified-debuggable-evidence.mjs)
//   overInstall()       installs the second debuggable build over the paid one -> details
//   reinstall()         uninstalls and installs the run's artifact again -> details
//   deviceLog()         the device log since the run began (extra evidence, never a pass rule)
//   now()               ms clock shared with the proxy log
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  assertEntitlementPreserved,
  assertNonComplimentary,
  assertServerPaid,
  assertServerUnpaid,
  attributeRestore,
  attributeServerPath,
  JourneyError,
  evidenceRecord,
  jsDevEvidence,
  journeyVerdict,
  refreshPolicyFor,
  restoreBoundaryObserved,
} from './test-store-journey.mjs'

/** The two TD-04 assertions, recorded apart (TEA ruling, 2026-11-13). */
export const TD04 = Object.freeze({
  restore: 'TD-04 restore from the paywall in the lost-mirror state',
  signIn: 'TD-04 sign-in recovers access after a reinstall',
})

/** A stable, non-reversible reference to the member for evidence (no user id in records). */
export const memberRef = (userId) =>
  createHash('sha256').update(String(userId)).digest('hex').slice(0, 16)

export async function runJourney({ steps, io, server, platform, appId, metroEnv }) {
  const records = []
  const context = {}

  const unpaid = async () => {
    const state = await io.serverState()
    assertServerUnpaid(state)
    return { subscription: state.subscription.status, access: state.access.source }
  }
  const paidWithPath = async (since) => {
    const state = await io.waitForPaid()
    assertServerPaid(state)
    context.paid = state.subscription
    return {
      entitlementDelivered: true,
      startedAt: since,
      ...attributeServerPath({
        server,
        log: io.proxyLog(),
        since,
        subscription: state.subscription,
      }),
      subscription: pick(state.subscription),
      access: state.access,
    }
  }
  const stillPaid = async () => {
    const state = await io.serverState()
    assertServerPaid(state)
    assertEntitlementPreserved(context.paid, state.subscription)
    return { entitlementDelivered: true, subscription: pick(state.subscription) }
  }

  const handlers = {
    preflight: async () => {
      const member = await io.preflight()
      const state = await io.serverState()
      assertNonComplimentary(state.access)
      assertServerUnpaid(state)
      return { memberRef: memberRef(member.userId), ledger: member.ledger }
    },
    open: async () => {
      await io.launch()
      await io.flow('open-premium')
      return {}
    },
    'js-dev': async () =>
      jsDevEvidence({
        hierarchy: await io.hierarchy(),
        // The env Metro was started with, read only for the isolated-build flags.
        metroEnv: typeof metroEnv === 'function' ? metroEnv() : (metroEnv ?? {}),
        appId,
      }),
    'native-debuggable-r8': async () => io.minifiedEvidence(),
    // S4-12 order: cancel, then failure, while the member is unentitled and the control is offered.
    'unpaid-cancel': async () => {
      await io.flow('purchase-cancel')
      return {
        offerings: 'Test Store sheet opened',
        purchaseControlsOffered: true,
        outcome: 'cancelled: quiet return to the offer, no error',
        serverState: await unpaid(),
      }
    },
    'unpaid-failure': async () => {
      await io.flow('purchase-failure')
      return {
        offerings: 'Test Store sheet opened',
        purchaseControlsOffered: true,
        outcome: 'failed: purchase error shown',
        serverState: await unpaid(),
      }
    },
    'purchase-success': async () => {
      const since = io.now()
      await io.flow('purchase-success')
      return paidWithPath(since)
    },
    'purchase-success-webhook': async () => {
      const since = io.now()
      await io.flow('purchase-success-webhook')
      return paidWithPath(since)
    },
    'paid-controls': async () => {
      await io.flow('assert-entitled')
      // No purchase or restore control renders for a paid member, so a paid failure, a paid
      // cancel and a restore over live access cannot be started from the app (S4-12 gap).
      return {
        purchaseControlsOffered: false,
        restoreOffered: false,
        ...(await stillPaid()),
      }
    },
    'over-install': async () => {
      const install = await io.overInstall()
      await io.launch()
      await io.flow('open-premium')
      await io.flow('assert-entitled')
      return { install, ...(await stillPaid()) }
    },
    'reinstall-entitled': async () => {
      const install = await io.reinstall()
      await io.launch()
      await io.flow('open-premium')
      await io.flow('assert-entitled')
      // Sign-in, not restore, recovers access here: the server kept the entitlement and the
      // paywall offers no restore while entitled. Restore is proved on its own in the
      // lost-mirror scenario.
      return {
        assertion: TD04.signIn,
        install,
        restoreOffered: false,
        ...(await stillPaid()),
      }
    },
    'purchase-unsynced': async () => {
      context.purchaseStartedAt = io.now()
      await io.flow('purchase-unsynced')
      return { sdkSuccess: true, serverState: await unpaid() }
    },
    reinstall: async () => {
      const install = await io.reinstall()
      await io.launch()
      await io.flow('open-premium')
      return { install, serverState: await unpaid() }
    },
    'restore-rejected': async () => {
      await io.flow('restore-rejected')
      return { restoreError: 'shown', serverState: await unpaid() }
    },
    'restore-success': async () => {
      const tapAt = io.now()
      // The flow asserts not entitled before the tap and entitled after it.
      await io.flow('restore-success')
      const state = await io.waitForPaid()
      assertServerPaid(state)
      return {
        assertion: TD04.restore,
        entitlementDelivered: true,
        uiTransition: 'not entitled before the restore tap, entitled after it',
        ...attributeRestore({
          log: io.proxyLog(),
          purchaseStartedAt: context.purchaseStartedAt,
          tapAt,
          subscription: state.subscription,
        }),
        subscription: pick(state.subscription),
        access: state.access,
        sdkBoundary: restoreBoundaryObserved({ platform, log: await io.deviceLog() }),
      }
    },
  }

  for (const step of steps) {
    const handler = handlers[step]
    try {
      if (!handler) throw new Error(`test_store_step_unknown: ${step}`)
      io.setPolicy(refreshPolicyFor(step))
      const details = await handler()
      records.push(evidenceRecord({ step, server, ...details }))
    } catch (error) {
      records.push(
        evidenceRecord({
          step,
          server,
          pass: false,
          error: error.code ?? String(error.message).split(':')[0],
          message: String(error.message).slice(0, 600),
        })
      )
      break
    }
  }
  return { records, verdict: journeyVerdict(steps, records) }
}

/**
 * The operator's re-check of a preview run (TEA-18): the member is still paid on the preview
 * API's read endpoints, and the run's proxy log shows no refresh reached the API after the
 * purchase began, so the webhook delivered the entitlement.
 */
export function verifyWebhookDelivery({ report, state, userId }) {
  if (report?.server !== 'preview')
    throw new JourneyError('test_store_verify_not_preview')
  const purchase = report.records?.find(
    (record) => record.step === 'purchase-success-webhook'
  )
  if (!purchase?.pass || !Number.isFinite(purchase.startedAt))
    throw new JourneyError('test_store_verify_no_webhook_purchase')
  if (memberRef(userId) !== report.memberRef)
    throw new JourneyError('test_store_verify_member_mismatch')
  assertServerPaid(state)
  return {
    memberRef: report.memberRef,
    ...attributeServerPath({
      server: 'preview',
      log: report.proxyLog ?? [],
      since: purchase.startedAt,
      subscription: state.subscription,
    }),
    subscription: pick(state.subscription),
    access: state.access,
  }
}

const pick = (subscription) => ({
  status: subscription.status,
  store: subscription.store,
  productId: subscription.productId,
  currentPeriodEnd: subscription.currentPeriodEnd,
  syncedAt: subscription.syncedAt,
})

/** sha256 of a file, or of every file under a directory (an iOS .app bundle), in path order. */
export function artifactSha256(file) {
  const hash = createHash('sha256')
  const walk = (current) => {
    if (fs.statSync(current).isDirectory())
      for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name))
    else {
      hash.update(path.relative(file, current))
      hash.update(fs.readFileSync(current))
    }
  }
  walk(file)
  return hash.digest('hex')
}

/**
 * CX-10: one `test-store` evidence manifest per device artifact, naming the commit it was built
 * from and each input's object id there, plus the artifact itself. `artifacts` is
 * [{ name, file, rev }]; `manifest` is evidence-manifest.mjs's writeManifest, passed in so the
 * measuring tool stays out of the leg's code closure. Returns the written paths.
 */
export function writeArtifactManifests({
  out,
  artifacts,
  cwd,
  manifest,
  hash = artifactSha256,
  write = fs.writeFileSync,
}) {
  return artifacts.map(({ name, file, rev }) => {
    if (!rev) throw new Error(`test_store_manifest_rev_missing: ${name}`)
    const record = {
      ...manifest({ leg: 'test-store', rev, cwd }),
      artifact: {
        name,
        file: file ? path.basename(file) : null,
        sha256: file ? hash(file) : null,
      },
    }
    const target = path.join(out, `${name}.manifest.json`)
    write(target, `${JSON.stringify(record, null, 2)}\n`)
    return target
  })
}
