#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { classifyWorkspaceOutput } from '../.github/actions/unit-test-coverage-comment/test-failures.mjs'

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
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const coverageDirs = JSON.stringify(
  workspaces.map((workspace) => `${workspace.path}/coverage`)
)

if (workspaces.length === 0) {
  console.error('No workspaces define a test:coverage script.')
  process.exit(1)
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `coverage_dirs=${coverageDirs}\n`)
}

// Streams the workspace's output as before and keeps a copy, so a failure can be
// classified as a failing test or a missed coverage threshold.
function runWorkspace(workspace) {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(
      npmExecutable,
      ['run', 'test:coverage', '--workspace', workspace.path],
      {
        cwd: process.cwd(),
        stdio: ['inherit', 'pipe', 'pipe'],
        env: process.env,
        // Node refuses to run npm.cmd without a shell on Windows. The arguments are
        // fixed strings and a workspace directory name, so nothing user-typed is quoted.
        shell: process.platform === 'win32',
      }
    )
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      output += chunk
    })
    child.on('error', (error) =>
      resolve({ status: 1, output: `${output}\n${error.message}` })
    )
    child.on('close', (status) => resolve({ status, output }))
  })
}

const failures = []

for (const workspace of workspaces) {
  console.log(`\n==> Running coverage for ${workspace.path} (${workspace.name})`)

  const result = await runWorkspace(workspace)
  if (result.status !== 0) {
    failures.push({
      workspace: workspace.path,
      ...classifyWorkspaceOutput(result.output),
    })
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `failures=${JSON.stringify(failures)}\n`)
}

if (failures.length > 0) {
  console.error('\nCoverage failed in the following workspaces:')
  for (const failure of failures) {
    console.error(`- ${failure.workspace} (${failure.reason})`)
  }
  process.exit(1)
}
