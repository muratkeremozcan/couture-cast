// Production deploys from CI only: git pushes create no Vercel deployment at all (each one, an
// ignored build included, counts toward Hobby's 100 a day), pw-e2e-prod.yml provides production
// through scripts/vercel-preview-deploy.mjs --production, which deploys only when the build
// inputs or the production configuration changed, and every production SHA check expects the
// commit that step reports production serves, which for a main commit that changed no app
// input is the earlier commit already deployed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const workflow = parse(read('../../.github/workflows/pw-e2e-prod.yml'))
const jobs = workflow.jobs

test('no git push creates a Vercel deployment, main included', () => {
  for (const app of ['web', 'api']) {
    const config = JSON.parse(read(`../../apps/${app}/vercel.json`))
    assert.equal(config.git.deploymentEnabled, false, app)
  }
})

for (const project of ['web', 'api']) {
  test(`main provides the ${project} production deployment through the CI deploy path`, () => {
    const job = jobs[`deploy-${project}`]
    assert.ok(job, `deploy-${project}`)
    assert.ok(job['timeout-minutes'] <= 20)
    const deploy = job.steps.find((step) => step.id === 'deploy')
    assert.equal(
      deploy.run,
      `node scripts/vercel-preview-deploy.mjs ${project} --production`
    )
    assert.equal(deploy.env.GIT_REF, 'main')
    assert.equal(deploy.env.EXPECTED_SHA, '${{ github.sha }}')
    assert.equal(deploy.env.VERCEL_TOKEN, '${{ secrets.VERCEL_TOKEN }}')
    assert.match(deploy.env.FORCE_BUILD, /inputs\.force_deploy/)
    assert.equal(job.outputs.sha, `\${{ steps.deploy.outputs.${project}_sha }}`)
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    assert.equal(checkout.with.ref, '${{ github.sha }}')
  })

  test(`the ${project} health wait expects the commit production serves, not main's head`, () => {
    const wait = jobs[`wait-${project}`]
    assert.deepEqual([wait.needs].flat(), [`deploy-${project}`])
    assert.equal(wait.with.expected_sha, `\${{ needs.deploy-${project}.outputs.sha }}`)
  })
}

test('the production e2e run expects the web commit production serves', () => {
  const run = jobs['run-prod-tests']
  assert.deepEqual([run.needs].flat().sort(), ['deploy-web', 'wait-api', 'wait-web'])
  assert.equal(run.with.expected_web_sha, '${{ needs.deploy-web.outputs.sha }}')
})

test('a manual run can force both production deployments', () => {
  const input = (workflow.on ?? workflow[true]).workflow_dispatch.inputs.force_deploy
  assert.equal(input.type, 'boolean')
  assert.equal(input.default, false)
})

test('no other workflow compares production with the pushed commit', () => {
  const pushed = /expected_sha:\s*\$\{\{\s*github\.sha\s*\}\}/
  assert.doesNotMatch(read('../../.github/workflows/pw-e2e-prod.yml'), pushed)
})
