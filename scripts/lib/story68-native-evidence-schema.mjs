import {
  closedShareCardAuditReport,
  shareCardAuditLocales,
  shareCardAuditStates,
  shareCardAuditTestIDs,
  shareCardNativeBehaviors,
} from './share-card-audit-report.mjs'

// Closed schemas for the native evidence families that public-evidence.mjs publishes.
// Every object has exact keys; anything unlisted, missing or mistyped is rejected.

/** iOS opens the Settings app root with a status-bar breadcrumb back to this app. */
export const IOS_SETTINGS_MARKERS = Object.freeze([
  'com.apple.settings.general',
  'Return to CoutureCast Story68',
])
export const IOS_RETRYABLE_DENIAL_EVIDENCE =
  'restricted adapter response; iOS denies further runtime prompts after its first real denial'
// Mirrors the states bridge-a11y.mjs requires per locale.
const bridgeStates = [
  'saved',
  'storage',
  'offline',
  'permissionDenied',
  'permissionPermanent',
  'limited',
  'finishingSave',
  'nativeSaveUnavailable',
  'preparing',
]
const auditTemplate = closedShareCardAuditReport({}, {}, '')

// Each schema node is a checker; composite nodes hold the checkers of their parts.
const literal = (expected) => (value) => value === expected
const oneOf =
  (...values) =>
  (value) =>
    values.includes(value)
const integer = (min, max) => (value) =>
  Number.isSafeInteger(value) && value >= min && value <= max
const pattern = (expression, max) => (value) =>
  typeof value === 'string' && value.length <= max && expression.test(value)
const nullable = (schema) => (value) => value === null || schema(value)
const list = (item, max) => (value) =>
  Array.isArray(value) && value.length <= max && value.every(item)
const object =
  (fields, optional = []) =>
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const keys = Object.keys(value)
    return (
      Object.keys(fields).every(
        (key) => optional.includes(key) || Object.hasOwn(value, key)
      ) && keys.every((key) => Object.hasOwn(fields, key) && fields[key](value[key]))
    )
  }
const TRUE = literal(true)
const BOOLEAN = (value) => typeof value === 'boolean'
const count = integer(0, 100000)

const matrix = (platform) =>
  object({
    platform: literal(platform),
    cases: list(
      object({
        id: pattern(/^[MU]-[A-Z0-9-]+(?:[ :][A-Za-z0-9_-]+)*$/, 120),
        passed: TRUE,
      }),
      200
    ),
    completed: BOOLEAN,
  })
const auditTest = oneOf(...shareCardAuditTestIDs)
const auditState = oneOf(...shareCardAuditStates)
const tccValue = nullable(integer(0, 5))
const tcc = object({ read: tccValue, addOnly: tccValue })
const afterSave = ['readPermissionAfterSave', 'readRemainedDenied', 'addOnlyGranted']
const schemas = {
  'native-matrix-android.json': matrix('android'),
  'native-matrix-ios.json': matrix('ios'),
  'accessibility-android.json': object({
    platform: literal('android'),
    service: literal('TalkBack'),
    actualService: TRUE,
    openTitleFocus: TRUE,
    saveFocusContained: TRUE,
    cancelOpenerFocus: TRUE,
    ownedSavingFocus: TRUE,
    reopenedFinishingFocus: TRUE,
    watermarkReenabled: TRUE,
    existingHeaderLabels: TRUE,
    traversalLabelsTraits: TRUE,
  }),
  'accessibility-ios.json': object({
    platform: literal('ios'),
    method: literal(auditTemplate.method),
    auditTypes: literal('all'),
    passed: BOOLEAN,
    counts: object({ total: count, passed: count, failed: count, skipped: count }),
    tests: list(
      object({ id: auditTest, result: oneOf('Passed', 'Failed', 'Skipped', 'Unknown') }),
      shareCardAuditTestIDs.length * 4
    ),
    failedTestIDs: list(auditTest, shareCardAuditTestIDs.length * 4),
    missingTests: list(auditTest, shareCardAuditTestIDs.length),
    missingStates: list(auditState, shareCardAuditStates.length),
    missingLocaleWatermarks: list(
      oneOf(
        ...shareCardAuditLocales.flatMap((locale) => [`${locale}:on`, `${locale}:off`])
      ),
      shareCardAuditLocales.length * 2
    ),
    nativeBehaviors: list(oneOf(...shareCardNativeBehaviors), 4),
    missingNativeBehaviors: list(oneOf(...shareCardNativeBehaviors), 4),
    states: list(
      object({
        locale: oneOf(...shareCardAuditLocales),
        state: auditState,
        watermark: oneOf('on', 'off', 'none'),
        fullLabelAndImageTrait: BOOLEAN,
        ownLocalizedStatusElement: BOOLEAN,
        traversalAndIntendedFocusTarget: TRUE,
      }),
      1000
    ),
    strictIssues: list(
      object({
        state: auditState,
        type: integer(0, 2 ** 32),
        hasElement: BOOLEAN,
        compact: oneOf(
          'Potentially inaccessible element',
          'Potentially inaccessible text',
          'Element has no description',
          'unclassified_audit_issue'
        ),
      }),
      1000
    ),
    focusEvidence: literal(auditTemplate.focusEvidence),
    announcementEvidence: literal(auditTemplate.announcementEvidence),
  }),
  'accessibility-bridge.json': object({
    method: literal(
      'React Native posted accessibility announcement and intended focus bridge unit assertions'
    ),
    passed: BOOLEAN,
    cases: list(
      object({
        locale: oneOf(...shareCardAuditLocales),
        state: oneOf(...bridgeStates),
        passed: BOOLEAN,
      }),
      shareCardAuditLocales.length * bridgeStates.length
    ),
    runner: object({
      classification: oneOf(
        'passed',
        'browser_missing',
        'browser_dependencies_missing',
        'runner_start_failed',
        'report_invalid',
        'report_missing',
        'tests_failed',
        'assertions_missing'
      ),
      exitCode: nullable(integer(-255, 255)),
      reportPresent: BOOLEAN,
      reportSuccessful: BOOLEAN,
      assertionsObserved: count,
      assertionsFailed: count,
      matchedCases: count,
      requiredCases: count,
    }),
  }),
  'expo-go-unavailable.json': object({
    platform: literal('ios'),
    actualExpoGo: TRUE,
    nativeAdapterAbsent: TRUE,
    previewLoaded: TRUE,
    saveDisabled: TRUE,
    actualAssetCountUnchanged: TRUE,
  }),
  'permission-ios.json': object(
    {
      platform: literal('ios'),
      actualAddOnlyDenial: TRUE,
      readPermissionBeforeSave: tcc,
      canAskAgain: literal(false),
      actualSettingsOpened: TRUE,
      settingsEvidence: object({
        foregroundMarkers: list(oneOf(...IOS_SETTINGS_MARKERS), 2),
      }),
      settingsGrantReturnedWithoutImport: TRUE,
      retryableDenialEvidence: literal(IOS_RETRYABLE_DENIAL_EVIDENCE),
      readPermissionAfterSave: tcc,
      readRemainedDenied: TRUE,
      addOnlyGranted: TRUE,
    },
    afterSave
  ),
}

export const nativeEvidenceFamilies = Object.freeze(Object.keys(schemas))

/** Throws a closed code unless `value` is exactly the published shape for `name`. */
export function assertNativeEvidence(name, value) {
  const schema = schemas[name]
  if (!schema) throw new Error('unknown_native_evidence_family')
  const valid =
    schema(value) &&
    // Settings evidence lists every marker once; the after-save trio is all or none.
    (name !== 'permission-ios.json' ||
      (new Set(value.settingsEvidence.foregroundMarkers).size ===
        IOS_SETTINGS_MARKERS.length &&
        [0, afterSave.length].includes(
          afterSave.filter((key) => Object.hasOwn(value, key)).length
        )))
  if (!valid) throw new Error('invalid_native_evidence')
  return value
}
