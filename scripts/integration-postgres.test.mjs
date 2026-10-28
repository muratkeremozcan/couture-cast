import assert from 'node:assert/strict'
import test from 'node:test'
import { qualityGateProvisioningSql } from './integration-postgres.mjs'

test('local integration Postgres provisions exactly what quality-gate provisions', () => {
  const sql = qualityGateProvisioningSql()
  for (const statement of [
    'CREATE ROLE authenticated',
    'CREATE ROLE service_role NOLOGIN BYPASSRLS',
    'CREATE OR REPLACE FUNCTION auth.jwt()',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated',
  ])
    assert.ok(sql.includes(statement), statement)
})

test('a workflow without the provisioning step is refused', () => {
  assert.throws(
    () => qualityGateProvisioningSql('jobs:\n  quality-gate:\n    steps: []\n'),
    /provisioning SQL not found/
  )
})
