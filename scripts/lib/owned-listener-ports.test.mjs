// The owned harnesses' fixed listener ports sit below every runner's ephemeral range.
//
// A port inside Linux's range (32768-60999) or macOS's (49152-65535) can be the local port the
// kernel gives any outgoing connection the job opens, and a listen on it then fails with
// EADDRINUSE while nothing listens there. The share-card auth proxy sat on 53068: in run
// 44145335277 (PR 252 browser-acceptance) it was gone, with no auth-harness.json, before the web
// build had waited 120 s. scripts/ci/ci-supabase-ports.mjs moved the Supabase ports for the same
// reason (run 43079319997).
import assert from 'node:assert/strict'
import test from 'node:test'
import { EPHEMERAL_FLOOR } from '../ci/ci-supabase-ports.mjs'
import {
  STORY68_API_ORIGIN,
  STORY68_AUTH_ORIGIN,
  STORY68_AUTH_PROXY_PORT,
} from './story68-public-build-env.mjs'
import {
  API_PORT,
  AUTH_PROXY_PORT,
  WEATHER_DOUBLE_PORT,
  WEB_PORT,
} from '../e2e-real-session/harness.mjs'

test('the share-card harness listens on its exact ports, all below the ephemeral range', () => {
  assert.equal(EPHEMERAL_FLOOR, 32768)
  assert.equal(STORY68_AUTH_PROXY_PORT, 23068)
  assert.equal(STORY68_AUTH_ORIGIN, 'http://127.0.0.1:23068')
  assert.equal(STORY68_API_ORIGIN, 'http://127.0.0.1:4088')
  for (const port of [STORY68_AUTH_PROXY_PORT, 4088, 8089, 3088])
    assert.ok(port < EPHEMERAL_FLOOR, `${port} is inside the ephemeral range`)
})

test('the real-session harness listens on its exact ports, all below the ephemeral range', () => {
  assert.deepEqual(
    { API_PORT, WEB_PORT, AUTH_PROXY_PORT, WEATHER_DOUBLE_PORT },
    { API_PORT: 4077, WEB_PORT: 3077, AUTH_PROXY_PORT: 23051, WEATHER_DOUBLE_PORT: 4087 }
  )
  for (const port of [API_PORT, WEB_PORT, AUTH_PROXY_PORT, WEATHER_DOUBLE_PORT])
    assert.ok(port < EPHEMERAL_FLOOR, `${port} is inside the ephemeral range`)
})
