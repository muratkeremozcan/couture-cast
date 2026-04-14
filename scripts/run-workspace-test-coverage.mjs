#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const workspaceRoots = ['apps', 'packages']

function findCoverageWorkspaces() {
  const workspaces = []

  for (const root of workspaceRoots) {
    const rootPath = path.join(process.cwd(), root)
    if (!existsSync(rootPath)) {
      continue
    }

    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const workspacePath = path.join(root, entry.name)
      const packageJsonPath = path.join(process.cwd(), workspacePath, 'package.json')
      if (!existsSync(packageJsonPath)) {
        continue
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      if (packageJson.scripts?.['test:coverage']) {
        workspaces.push({
          name: packageJson.name ?? workspacePath,
          path: workspacePath,
        })
      }
    }
  }

  return workspaces.sort((left, right) => left.path.localeCompare(right.path))
}

const workspaces = findCoverageWorkspaces()

if (workspaces.length === 0) {
  console.error('No workspaces define a test:coverage script.')
  process.exit(1)
}

const failedWorkspaces = []

for (const workspace of workspaces) {
  console.log(`\n==> Running coverage for ${workspace.path} (${workspace.name})`)

  const result = spawnSync(
    'npm',
    ['run', 'test:coverage', '--workspace', workspace.path],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    }
  )

  if (result.status !== 0) {
    failedWorkspaces.push(workspace.path)
  }
}

if (failedWorkspaces.length > 0) {
  console.error('\nCoverage failed in the following workspaces:')
  for (const workspacePath of failedWorkspaces) {
    console.error(`- ${workspacePath}`)
  }
  process.exit(1)
}
