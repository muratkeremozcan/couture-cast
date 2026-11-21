import { EventEmitter } from 'node:events'
import type { BrowserContext } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import {
  classifyGuardedErrors,
  guardExpectedError,
  unexpectedRitualErrors,
  type GuardedError,
} from './expected-error-guard'

const allowed = { method: 'POST', status: 409, code: 'UPLOAD_BYTES_MISSING' }
const url = 'http://127.0.0.1:3005/api/v1/wardrobe/silhouette/my-form/commit'
const expected: GuardedError = {
  method: 'POST',
  status: 409,
  code: 'UPLOAD_BYTES_MISSING',
  url,
}

describe('classifyGuardedErrors', () => {
  it('counts the expected error and reports nothing else', () => {
    expect(classifyGuardedErrors([expected], allowed)).toEqual({
      allowedCount: 1,
      unexpected: [],
    })
  })

  it('counts a repeat of the expected error, so a caller requiring one sees two', () => {
    expect(classifyGuardedErrors([expected, expected], allowed).allowedCount).toBe(2)
  })

  it('reports none when the expected error never happened', () => {
    expect(classifyGuardedErrors([], allowed)).toEqual({
      allowedCount: 0,
      unexpected: [],
    })
  })

  it('reports an error on another method of the same URL', () => {
    const stray: GuardedError = { method: 'GET', status: 500, url }
    expect(classifyGuardedErrors([expected, stray], allowed)).toEqual({
      allowedCount: 1,
      unexpected: [stray],
    })
  })

  it('reports the expected method and status with another code, or with none', () => {
    const otherCode: GuardedError = {
      method: 'POST',
      status: 409,
      code: 'UPLOAD_IN_PROGRESS',
      url,
    }
    const noCode: GuardedError = { method: 'POST', status: 409, url }
    expect(classifyGuardedErrors([otherCode, noCode], allowed).unexpected).toEqual([
      otherCode,
      noCode,
    ])
  })

  it('reports the expected method and code with another status', () => {
    const wrongStatus: GuardedError = {
      method: 'POST',
      status: 500,
      code: 'UPLOAD_BYTES_MISSING',
      url,
    }
    expect(classifyGuardedErrors([wrongStatus], allowed).unexpected).toEqual([
      wrongStatus,
    ])
  })
})

describe('guardExpectedError', () => {
  it('distinguishes an interrupted body read from a readable error without a message', async () => {
    const emitter = new EventEmitter()
    const guard = guardExpectedError(emitter as unknown as BrowserContext, /commit$/)
    const metadata = { method: 'POST', status: 409, url }
    const response = {
      request: () => ({ method: () => metadata.method }),
      status: () => metadata.status,
      url: () => metadata.url,
    }
    emitter.emit('response', {
      ...response,
      body: () => Promise.resolve(Buffer.from('{}')),
    })
    emitter.emit('response', {
      ...response,
      body: () => Promise.reject(new Error('Navigation interrupted the response')),
    })

    expect(await guard.settle()).toEqual([
      metadata,
      { ...metadata, bodyUnreadable: true },
    ])
  })
})

it('retains ritual errors outside the missing-city recovery', () => {
  const missingCity = {
    method: 'GET',
    status: 400,
    url: 'http://127.0.0.1:3005/api/v1/ritual?locale=en-US',
  }
  const wrongMessage = { ...missingCity, code: 'Other bad request' }
  const unavailable = { ...missingCity, status: 503, bodyUnreadable: true as const }
  const otherMethod = { ...missingCity, method: 'POST', bodyUnreadable: true as const }
  expect(
    unexpectedRitualErrors([
      { ...missingCity, code: 'No location preferences found for user' },
      { ...missingCity, bodyUnreadable: true },
      missingCity,
      wrongMessage,
      unavailable,
      otherMethod,
    ])
  ).toEqual([missingCity, wrongMessage, unavailable, otherMethod])
})
