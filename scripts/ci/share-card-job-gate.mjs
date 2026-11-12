import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const requiredShareCardJobs = Object.freeze([
  // The API32 journey runs as two shards; its evidence job proves both reported their cases.
  'original-resource',
  'original-resource-evidence',
  'browser-acceptance',
  'android36-native-matrix',
  // Both API36 matrix shards reported exactly their cases (a matrix job succeeds only when both
  // legs do, so this job also catches a leg that passed without its full report).
  'android36-matrix-evidence',
  'android36-original',
  'android36-controls',
  'android36-interaction',
  'android36-release-font',
  // The iOS journey: one build, two shards (a matrix job succeeds only when both legs do) and
  // the job that proves both shards reported their exact cases.
  'ios-build',
  'ios-shard',
  'ios-evidence',
  // The Expo Go proof on its own fresh simulator.
  'ios-expo-go',
])

// The lanes that run on a pull request. Every other required job drives a device or an emulator
// for over an hour, so the workflow skips it there and runs it on main, nightly and on demand.
export const pullRequestShareCardJobs = Object.freeze(['browser-acceptance'])
export const pullRequestEvent = 'pull_request'

// The job that plans the lanes (scripts/ci/lanes.mjs), and the lane that gates the browser job.
// On a pull request that changes nothing the browser lane builds, runs or reads, the plan skips
// browser-acceptance; every other event runs every lane.
export const laneJobName = 'lanes'
export const shareCardLane = 'share-card'
export const shareCardLaneCondition = `fromJSON(needs.${laneJobName}.outputs.plan)['${shareCardLane}']`

/** Whether a pull request's lane plan runs the browser lane; refuses an unreadable plan. */
function browserLaneRuns(plan) {
  if (
    !plan ||
    typeof plan !== 'object' ||
    Array.isArray(plan) ||
    typeof plan[shareCardLane] !== 'boolean'
  )
    throw new Error('share_card_lane_plan_invalid')
  return plan[shareCardLane]
}

/**
 * Missing, skipped, cancelled and failed jobs all prevent aggregate success, so a skipped shard
 * never counts. Only a pull_request run expects the device lanes to be skipped (and requires
 * it), and only there may the lane plan skip the browser lane, which then must be skipped; any
 * other event, an unknown one included, needs every job to succeed whatever the plan says.
 */
export function assertShareCardJobs(results, eventName, plan) {
  if (
    !results ||
    typeof results !== 'object' ||
    Array.isArray(results) ||
    Object.keys(results).length !== requiredShareCardJobs.length ||
    Object.keys(results).some((name) => !requiredShareCardJobs.includes(name))
  )
    throw new Error('share_card_job_results_invalid')
  const deviceLanesSkipped = eventName === pullRequestEvent
  const browserRuns = deviceLanesSkipped ? browserLaneRuns(plan) : true
  const expected = (name) => {
    if (!deviceLanesSkipped) return 'success'
    if (!pullRequestShareCardJobs.includes(name)) return 'skipped'
    return browserRuns ? 'success' : 'skipped'
  }
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
    // The gate needs the lanes job only to read its plan, which arrives in CC68_LANE_PLAN; a
    // failed lanes job leaves that empty, which a pull request refuses.
    if (results && typeof results === 'object' && !Array.isArray(results))
      delete results[laneJobName]
    let plan
    try {
      plan = JSON.parse(process.env.CC68_LANE_PLAN ?? '')
    } catch {
      plan = undefined
    }
    console.log(
      `Required share-card jobs passed: ${assertShareCardJobs(
        results,
        process.env.CC68_EVENT_NAME,
        plan
      ).join(', ')}`
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
