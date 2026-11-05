// Story 6.12 test owner: U-R-ORDER. Flags decide after the guards, and no flag answer reaches a body.
// The guards themselves are proved at HTTP in moderation-sla-route.integration.spec.ts.
import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { Reflector } from '@nestjs/core'
import { API_ROLES_KEY } from '../auth/security.decorators.js'
import { ModerationSlaController } from './moderation-sla.controller.js'

const auth = { userId: 'moderator-1', role: 'moderator' } as never
const summary = { data: { serverNow: 'x' } }

function build(flagAnswers: Record<string, boolean | Error>) {
  const getFeatureFlag = vi.fn((key: string) => {
    const answer = flagAnswers[key] ?? true
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  })
  const sla = { summary: vi.fn().mockResolvedValue(summary) }
  return {
    getFeatureFlag,
    sla,
    controller: new ModerationSlaController(sla as never, { getFeatureFlag } as never),
  }
}

describe('U-R-ORDER', () => {
  it('reads both flags for the viewer and returns the summary', async () => {
    const { controller, getFeatureFlag } = build({})
    await expect(controller.getSla(auth)).resolves.toBe(summary)
    expect(getFeatureFlag.mock.calls.map(([key]) => key).sort()).toEqual([
      'moderation_console_enabled',
      'moderation_sla_monitoring_enabled',
    ])
    for (const call of getFeatureFlag.mock.calls)
      expect((call as unknown as [string, string])[1]).toBe('moderator-1')
  })

  it.each([
    ['monitoring off', { moderation_sla_monitoring_enabled: false }],
    ['console off', { moderation_console_enabled: false }],
    ['monitoring read throws', { moderation_sla_monitoring_enabled: new Error('down') }],
    ['console read throws', { moderation_console_enabled: new Error('down') }],
  ])('%s gives 503 moderation_sla_disabled and reads no data', async (_name, answers) => {
    const { controller, sla } = build(answers)
    const failure = await controller.getSla(auth).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ServiceUnavailableException)
    expect((failure as ServiceUnavailableException).getResponse()).toEqual({
      statusCode: 503,
      code: 'moderation_sla_disabled',
      message: expect.any(String) as string,
    })
    expect(sla.summary).not.toHaveBeenCalled()
  })

  it('declares the moderator and admin roles on the class', () => {
    const roles = new Reflector().get<string[]>(API_ROLES_KEY, ModerationSlaController)
    expect(roles === undefined ? [] : [...roles].sort()).toEqual(['admin', 'moderator'])
  })
})
