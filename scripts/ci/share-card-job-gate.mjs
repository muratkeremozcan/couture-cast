import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const requiredShareCardJobs = Object.freeze([
  'original-resource',
  'browser-acceptance',
  'android36-native-matrix',
  'android36-original',
  'android36-interaction',
])

/** Missing, skipped, cancelled and failed jobs all prevent aggregate success. */
export function assertShareCardJobs(results) {
  if (
    !results ||
    typeof results !== 'object' ||
    Array.isArray(results) ||
    Object.keys(results).length !== requiredShareCardJobs.length ||
    Object.keys(results).some((name) => !requiredShareCardJobs.includes(name))
  )
    throw new Error('share_card_job_results_invalid')
  const failed = requiredShareCardJobs.filter(
    (name) => results[name]?.result !== 'success'
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
      `Required share-card jobs passed: ${assertShareCardJobs(results).join(', ')}`
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
