#!/usr/bin/env node
// Starts the same database the CI integration tier uses: stock postgres:17-alpine with
// the roles and auth schema quality-gate provisions, read from pr-checks.yml so the
// two cannot drift.
//
// Local Supabase preloads extensions that CI's database does not, plpgsql_check among
// them. Its pldbgapi2 layer hooks every PL/pgSQL call and has been seen to abort an
// ordinary nested call with XX000 "cannot find parent statement on pldbgapi2 call
// stack" (upstream okbob/plpgsql_check#197). Integration runs against this server see
// what CI sees.
//
//   node scripts/integration-postgres.mjs start [--name N] [--port P]  prints the URL
//   node scripts/integration-postgres.mjs stop [--name N]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { parse } from 'yaml'

const IMAGE = 'postgres:17-alpine'
const option = (flag, fallback) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? fallback : process.argv[index + 1]
}
const name = option('--name', 'couturecast-integration-pg17')
const port = option('--port', '54329')
const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(`docker ${args[0]} failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

/** The provisioning SQL from quality-gate's own step. */
export function qualityGateProvisioningSql(
  workflow = fs.readFileSync('.github/workflows/pr-checks.yml', 'utf8')
) {
  const step = parse(workflow).jobs['quality-gate'].steps.find(
    (candidate) =>
      candidate.name === 'Provision Supabase-compatible roles and auth schema'
  )
  const sql = /<<'SQL'\n([\s\S]*?)\nSQL/.exec(step?.run ?? '')?.[1]
  if (!sql) throw new Error('quality-gate provisioning SQL not found')
  return sql
}

function start() {
  if (!docker('ps', '-aq', '--filter', `name=^${name}$`)) {
    docker(
      'run',
      '-d',
      '--name',
      name,
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-p',
      `127.0.0.1:${port}:5432`,
      IMAGE
    )
  } else docker('start', name)
  for (let attempt = 0; ; attempt++) {
    const ready = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'])
    if (ready.status === 0) break
    if (attempt > 60) throw new Error(`${name} did not become ready`)
    spawnSync('sleep', ['1'])
  }
  const provision = spawnSync(
    'docker',
    ['exec', '-i', name, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: qualityGateProvisioningSql(), encoding: 'utf8' }
  )
  if (provision.status !== 0) throw new Error(provision.stderr.trim())
  console.log(`postgresql://postgres:postgres@127.0.0.1:${port}/postgres`)
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv[2] === 'start') start()
  else if (process.argv[2] === 'stop') docker('rm', '-f', name)
  else throw new Error('usage: integration-postgres.mjs start|stop [--name N] [--port P]')
}
