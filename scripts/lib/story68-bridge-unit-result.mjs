/** Publish bounded runner facts; raw Vitest messages and paths stay private. */
export function bridgeUnitDiagnostics({
  result,
  report,
  log,
  invalidReport = false,
  matchedCases,
  requiredCases,
}) {
  const tests = (report?.testResults ?? []).flatMap((file) => file.assertionResults ?? [])
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 100000 ? value : 0
  const exitCode = Number.isInteger(result.status) ? result.status : null
  let classification = 'passed'
  if (/browserType\.launch: Executable doesn't exist/.test(log))
    classification = 'browser_missing'
  else if (
    /Host system is missing dependencies|error while loading shared libraries|Missing libraries:/.test(
      log
    )
  )
    classification = 'browser_dependencies_missing'
  else if (result.error || result.signal) classification = 'runner_start_failed'
  else if (invalidReport) classification = 'report_invalid'
  else if (!report) classification = 'report_missing'
  else if (exitCode !== 0 || report.success !== true) classification = 'tests_failed'
  else if (
    requiredCases <= 0 ||
    matchedCases !== requiredCases ||
    tests.length < matchedCases
  )
    classification = 'assertions_missing'
  return {
    classification,
    exitCode,
    reportPresent: report !== null,
    reportSuccessful: report?.success === true,
    assertionsObserved: count(tests.length),
    assertionsFailed: count(tests.filter((test) => test.status === 'failed').length),
    matchedCases: count(matchedCases),
    requiredCases: count(requiredCases),
  }
}
