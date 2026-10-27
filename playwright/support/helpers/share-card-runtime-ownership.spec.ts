import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
it('6.8-HARNESS existing-runtime refusal cannot invoke cleanup or mutate preexisting ownership', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc68-existing-runtime-'))
  try {
    const resources = JSON.stringify({
      invocationId: 'prior-owner',
      owner: 'cc68-impl',
      database: 'tea_community_' + 'a'.repeat(32),
      createdDatabase: true,
    })
    fs.writeFileSync(path.join(directory, 'resources.json'), resources)
    fs.writeFileSync(
      path.join(directory, 'existing-sentinel'),
      'preserve exact owned bytes'
    )
    // A regressed refusal still cannot provision: the empty working directory has no
    // .env.local or Supabase CLI, and no inherited database or service credentials.
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/e2e-share-card/prepare.mjs')],
      {
        cwd: directory,
        env: { PATH: process.env.PATH, CC68_HARNESS_DIR: directory },
        encoding: 'utf8',
      }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Runtime already provisioned')
    expect(fs.readFileSync(path.join(directory, 'resources.json'), 'utf8')).toBe(
      resources
    )
    expect(fs.readFileSync(path.join(directory, 'existing-sentinel'), 'utf8')).toBe(
      'preserve exact owned bytes'
    )
    expect(fs.readdirSync(directory).sort()).toEqual([
      'existing-sentinel',
      'resources.json',
    ])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
