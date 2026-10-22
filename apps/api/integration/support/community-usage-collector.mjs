// Story 6.5 acceptance: read-only 1 s usage sampler for owned processes, the UUID DB and Redis.
import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import pg from 'pg'

const run = promisify(execFile)
const url = new URL(process.env.STORY65_COLLECTOR_DATABASE_URL)
if (!/^\/tea_community_[a-f0-9]{32}$/.test(url.pathname))
  throw new Error('Isolated UUID DB required')
const redis = new URL(process.env.STORY65_COLLECTOR_REDIS_URL ?? 'redis://127.0.0.1:6379')
const db = new pg.Client({ connectionString: url.toString() })
await db.connect()
await db.query('SET default_transaction_read_only = on')
// pg_stat_statements lives in one database per server but reports every database, so it is
// read from the server's admin database and filtered to the UUID database.
const statementsUrl = process.env.STORY65_COLLECTOR_STATEMENTS_URL
const statementsDb = statementsUrl
  ? new pg.Client({ connectionString: statementsUrl })
  : undefined
await statementsDb?.connect()
await statementsDb?.query('SET default_transaction_read_only = on')
const present = statementsDb
  ? (
      await statementsDb.query(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS present"
      )
    ).rows[0].present
  : false
const databaseName = url.pathname.slice(1)

const tracked = new Map()
const samples = []
let timer

/** macOS and Linux `ps` print cumulative CPU as [[dd-]hh:]mm:ss[.cc]. */
function seconds(time) {
  const [days, clock] = time.includes('-') ? time.split('-') : ['0', time]
  return clock
    .split(':')
    .reverse()
    .reduce(
      (total, part, index) => total + Number(part) * 60 ** index,
      Number(days) * 86_400
    )
}

async function processes() {
  const pids = [...tracked.keys()]
  if (!pids.length) return {}
  const { stdout } = await run('ps', [
    '-o',
    'pid=,rss=,time=',
    '-p',
    pids.join(','),
  ]).catch((error) => ({ stdout: error.stdout ?? '' }))
  const rows = {}
  for (const line of stdout.trim().split('\n')) {
    const [pid, rss, time] = line.trim().split(/\s+/)
    if (!pid || !tracked.has(Number(pid))) continue
    rows[tracked.get(Number(pid))] = {
      pid: Number(pid),
      rssKb: Number(rss),
      cpuSeconds: seconds(time),
    }
  }
  return rows
}

async function database() {
  const [stats] = (
    await db.query(
      `SELECT numbackends, xact_commit, xact_rollback, tup_returned, tup_fetched, tup_inserted,
              tup_updated, tup_deleted, blks_read, blks_hit
         FROM pg_stat_database WHERE datname = current_database()`
    )
  ).rows
  const [{ connections }] = (
    await db.query(
      'SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname = current_database()'
    )
  ).rows
  const statements = present
    ? (
        await statementsDb.query(
          `SELECT coalesce(sum(calls), 0)::bigint AS calls FROM pg_stat_statements s
             JOIN pg_database d ON d.oid = s.dbid WHERE d.datname = $1`,
          [databaseName]
        )
      ).rows[0].calls
    : null
  return {
    ...Object.fromEntries(
      Object.entries(stats).map(([key, value]) => [key, Number(value)])
    ),
    connections,
    statementCalls: statements === null ? null : Number(statements),
  }
}

/** One inline `INFO` round trip; the shared service is only read. */
function redisInfo() {
  return new Promise((resolve) => {
    const socket = connect(Number(redis.port || 6379), redis.hostname)
    let text = ''
    const done = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(500, () => done(null))
    socket.on('error', () => done(null))
    socket.on('connect', () => socket.write('INFO\r\n'))
    socket.on('data', (chunk) => {
      text += chunk
      const header = /^\$(\d+)\r\n/.exec(text)
      if (header && Buffer.byteLength(text) >= header[0].length + Number(header[1])) {
        const fields = Object.fromEntries(
          text
            .split('\r\n')
            .filter((line) => line.includes(':'))
            .map((line) => line.split(':'))
        )
        done({
          commandsProcessed: Number(fields.total_commands_processed),
          connectedClients: Number(fields.connected_clients),
          usedMemory: Number(fields.used_memory),
          netInputBytes: Number(fields.total_net_input_bytes),
          netOutputBytes: Number(fields.total_net_output_bytes),
        })
      }
    })
  })
}

async function sample() {
  const started = performance.now()
  const [proc, dbStats, redisStats] = await Promise.all([
    processes(),
    database(),
    redisInfo(),
  ])
  samples.push({
    at: started,
    wall: Date.now(),
    processes: proc,
    database: dbStats,
    redis: redisStats,
    sampleMs: performance.now() - started,
  })
}

function schedule() {
  timer = setTimeout(() => {
    void sample()
      .catch((error) =>
        samples.push({
          at: performance.now(),
          wall: Date.now(),
          error: error.code ?? error.name,
        })
      )
      .finally(schedule)
  }, 1000)
}

process.send?.({
  event: 'ready',
  value: { pid: process.pid, statements: present },
})
process.on('message', async ({ id, op, args }) => {
  try {
    let value = null
    if (op === 'track')
      for (const [name, pid] of Object.entries(args)) tracked.set(pid, name)
    if (op === 'start') {
      await sample()
      schedule()
    }
    if (op === 'stop') {
      clearTimeout(timer)
      await sample()
      value = {
        statementsExtension: present,
        redis: redis.host,
        samples: samples.splice(0),
      }
    }
    if (op === 'close') {
      clearTimeout(timer)
      await db.end()
      await statementsDb?.end()
      process.send?.({ id, value })
      process.disconnect()
      return
    }
    process.send?.({ id, value })
  } catch (error) {
    process.send?.({ id, error: error.code ?? error.name })
  }
})
