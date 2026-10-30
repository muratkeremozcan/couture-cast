import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const requiredShareCardJobs = Object.freeze([
  'original-resource',
  'browser-acceptance',
  'android36-native-matrix',
  'android36-original',
  'android36-interaction',
  // The iOS journey: one build, two shards (a matrix job succeeds only when both legs do) and
  // the job that proves both shards reported their exact cases.
  'ios-build',
  'ios-shard',
  'ios-evidence',
  // `ios-expo-go` (the Expo Go proof) is not here: it has never passed in CI, so it runs nightly
  // and on dispatch outside this gate. Follow-up: require it once it has passed.
])

// The lanes that run on a pull request. Every other required job drives a device or an emulator
// for over an hour, so the workflow skips it there and runs it on main, nightly and on demand.
export const pullRequestShareCardJobs = Object.freeze(['browser-acceptance'])
export const pullRequestEvent = 'pull_request'

/**
 * Missing, skipped, cancelled and failed jobs all prevent aggregate success, so a skipped shard
 * never counts. Only a pull_request run expects the device lanes to be skipped (and requires
 * it); any other event, an unknown one included, needs every job to succeed.
 */
export function assertShareCardJobs(results, eventName) {
  if (
    !results ||
    typeof results !== 'object' ||
    Array.isArray(results) ||
    Object.keys(results).length !== requiredShareCardJobs.length ||
    Object.keys(results).some((name) => !requiredShareCardJobs.includes(name))
  )
    throw new Error('share_card_job_results_invalid')
  const deviceLanesSkipped = eventName === pullRequestEvent
  const expected = (name) =>
    deviceLanesSkipped && !pullRequestShareCardJobs.includes(name) ? 'skipped' : 'success'
  const failed = requiredShareCardJobs.filter(
    (name) => results[name]?.result !== expected(name)
  )
  if (failed.length)
    throw new Error(`share_card_required_jobs_failed: ${failed.join(', ')}`)
  return [...requiredShareCardJobs]
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    let results
    try {
      results = JSON.parse(process.env.CC68_JOB_RESULTS ?? '')
    } catch {
      throw new Error('share_card_job_results_invalid')
    }
    console.log(
      `Required share-card jobs passed: ${assertShareCardJobs(
        results,
        process.env.CC68_EVENT_NAME
      ).join(', ')}`
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
