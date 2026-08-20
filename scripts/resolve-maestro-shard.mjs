/**
 * Resolve one CI shard's Maestro flow list, balanced by recorded flow COST
 * rather than flow COUNT.
 *
 * `NR % n == s % n` round robin (the previous approach, in
 * `.github/workflows/pr-mobile-e2e.yml` history) balances how many flows land
 * in each shard, not how long they take. Flow duration in this suite ranges
 * from under a minute to several minutes, so an equal-count split can still
 * hand one shard a disproportionately expensive slice, and that slice sets
 * the whole job's wall clock: every other shard finishes and waits on it.
 *
 * This does longest-processing-time-first (LPT) bin packing instead: sort
 * flows by known duration descending, and repeatedly drop the next flow into
 * whichever shard currently has the smallest total. LPT is a well known
 * approximation for makespan minimization; it will not always find the
 * mathematically optimal split, but it is simple, deterministic, and close
 * enough that hand-tuning the assignment is not worth the fragility of a
 * baked-in list that breaks the moment a flow is added, removed, or renamed.
 *
 * Usage:
 *   node scripts/resolve-maestro-shard.mjs --suite full --shard 3 --shards 6
 *
 * Prints GITHUB_OUTPUT-formatted lines to stdout (`empty=...` and, when a
 * shard has work, `list=...`), and a human-readable balance summary to
 * stderr so it shows up in the Actions log without polluting the outputs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const readArg = (name) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const fail = (message) => {
  console.error(`::error::${message}`)
  process.exit(1)
}

const SUITE = readArg('suite') || 'full'
const SHARD = Number(readArg('shard'))
const SHARDS = Number(readArg('shards'))

if (!Number.isInteger(SHARD) || SHARD < 1) {
  fail(`--shard must be a positive integer, got ${readArg('shard')}`)
}
if (!Number.isInteger(SHARDS) || SHARDS < 1) {
  fail(`--shards must be a positive integer, got ${readArg('shards')}`)
}
if (SHARD > SHARDS) {
  fail(`--shard (${SHARD}) cannot exceed --shards (${SHARDS})`)
}

/**
 * `maestro/subflows/` fragments are only ever reached through `runFlow`, so
 * the depth limit excludes them, and `config.yaml` is Maestro's own reserved
 * suite-configuration filename rather than a flow. Matches the discovery this
 * replaces.
 */
const discoverFullSuite = () =>
  fs
    .readdirSync(path.join(projectRoot, 'maestro'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .filter((entry) => entry.name !== 'config.yaml')
    .map((entry) => entry.name)
    .sort()

const SMOKE_SUITE = ['analytics.yaml', 'premium-subscription.yaml', 'sanity.yaml']

const flowNames = SUITE === 'smoke' ? SMOKE_SUITE : discoverFullSuite()

// Zero flows is never legitimate, and has to be rejected before the
// empty-shard branch below: that branch treats an empty shard as expected
// whenever there are fewer flows than shards, which zero satisfies for every
// shard. A bad suite input or a moved flow directory is a broken pipeline,
// not a quietly passing one.
if (flowNames.length === 0) {
  fail(`Flow discovery found no flows to run. Suite input: '${SUITE}'.`)
}

const durationsPath = path.join(projectRoot, 'scripts', 'maestro-flow-durations.json')
const recordedDurations = JSON.parse(fs.readFileSync(durationsPath, 'utf8'))
const knownValues = Object.entries(recordedDurations)
  .filter(([key]) => !key.startsWith('_'))
  .map(([, value]) => value)
const meanDuration = Math.round(
  knownValues.reduce((sum, value) => sum + value, 0) / knownValues.length
)

const durationOf = (name) => {
  const recorded = recordedDurations[name]
  if (typeof recorded === 'number') return recorded
  console.error(
    `[shard] No recorded duration for ${name}; assuming the ${meanDuration}s mean. ` +
      'Add it to scripts/maestro-flow-durations.json once it has a real measurement.'
  )
  return meanDuration
}

// LPT: longest flow first, always into the currently lightest bin.
const bins = Array.from({ length: SHARDS }, () => ({ names: [], total: 0 }))
const sortedByDurationDesc = [...flowNames].sort(
  (a, b) => durationOf(b) - durationOf(a) || a.localeCompare(b)
)
for (const name of sortedByDurationDesc) {
  const lightest = bins.reduce((min, bin) => (bin.total < min.total ? bin : min))
  lightest.names.push(name)
  lightest.total += durationOf(name)
}

console.error(
  `[shard] ${flowNames.length} flow(s) across ${SHARDS} shard(s), suite=${SUITE}:`
)
bins.forEach((bin, index) => {
  const label = `shard ${index + 1}`
  const flows = bin.names.length > 0 ? bin.names.sort().join(', ') : '(empty)'
  console.error(`[shard]   ${label}: ${bin.total}s -- ${flows}`)
})

const thisBin = bins[SHARD - 1]
const thisShardFlows = thisBin.names.sort()

if (thisShardFlows.length === 0) {
  // Only legitimate when there are fewer flows than shards (the smoke
  // suite's usual case). With at least as many flows as shards, LPT always
  // seeds every bin from the first SHARDS flows, so an empty bin here means
  // something upstream is broken, not that this shard has nothing to do.
  if (flowNames.length < SHARDS) {
    console.log('empty=true')
    console.error(
      `Shard ${SHARD} of ${SHARDS} has no flows: only ${flowNames.length} flows in this suite. Skipping.`
    )
    process.exit(0)
  }
  fail(
    `Shard ${SHARD} of ${SHARDS} resolved no flows out of ${flowNames.length}. The distribution is wrong.`
  )
}

console.log('empty=false')
console.log(`list=${thisShardFlows.map((name) => `maestro/${name}`).join(' ')}`)
console.error(
  `Shard ${SHARD} of ${SHARDS} runs ${thisShardFlows.length} of ${flowNames.length} flows (~${thisBin.total}s): ${thisShardFlows.join(', ')}`
)
