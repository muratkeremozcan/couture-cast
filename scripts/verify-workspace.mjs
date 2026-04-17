#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: options.shell ?? false,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function normalizeWorkspaceDir(rawWorkspaceDir) {
  return rawWorkspaceDir.replace(/\/+$/, '')
}

function buildReadonlyApiLintCommand(workspaceDir) {
  const candidateDirs = ['src', 'apps', 'libs', 'test', 'integration']
    .map((directory) => path.join(repoRoot, workspaceDir, directory))
    .filter((directory) => fs.existsSync(directory))
    .map((directory) => path.relative(repoRoot, directory))

  if (candidateDirs.length === 0) {
    fail(`No lintable directories found for ${workspaceDir}.`)
  }

  return {
    label: 'lint',
    command: 'npm',
    args: ['exec', '--yes', '--', 'eslint', '--max-warnings=0', '--ext', '.ts', ...candidateDirs],
  }
}

function buildWorkspaceCommands(workspaceDir) {
  if (workspaceDir === 'apps/api') {
    return [
      buildReadonlyApiLintCommand(workspaceDir),
      {
        label: 'typecheck',
        command: 'npm',
        args: ['run', 'typecheck', '--workspace', workspaceDir],
      },
      {
        label: 'test',
        command: 'npm',
        args: ['run', 'test', '--workspace', workspaceDir],
      },
    ]
  }

  return ['lint', 'typecheck', 'test'].map((scriptName) => ({
    label: scriptName,
    command: 'npm',
    args: ['run', scriptName, '--workspace', workspaceDir],
  }))
}

const rawWorkspaceDir = process.argv[2]

if (!rawWorkspaceDir) {
  fail('Usage: node scripts/verify-workspace.mjs <workspace-dir>')
}

const workspaceDir = normalizeWorkspaceDir(rawWorkspaceDir)
const packageJsonPath = path.join(repoRoot, workspaceDir, 'package.json')

if (!fs.existsSync(packageJsonPath)) {
  fail(`Workspace package.json not found for ${workspaceDir}`)
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const workspaceLabel = `${packageJson.name} (${workspaceDir})`

console.log(`Verifying ${workspaceLabel}`)

for (const command of buildWorkspaceCommands(workspaceDir)) {
  console.log(`\n[${workspaceLabel}] ${command.label}`)
  run(command.command, command.args)
}
