#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const listOnly = process.argv.includes('--list')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    if (options.allowFailure) {
      return result
    }

    if (result.stdout) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
    process.exit(result.status ?? 1)
  }

  return result
}

function parseChangedPaths(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const entry = line.slice(3)
      const renamedTarget = entry.includes(' -> ')
        ? entry.slice(entry.lastIndexOf(' -> ') + 4)
        : entry

      return renamedTarget.replace(/^"+|"+$/g, '')
    })
}

function findWorkspaceDirs() {
  return ['packages', 'apps']
    .flatMap((parentDir) => {
      const absoluteParentDir = path.join(repoRoot, parentDir)
      if (!fs.existsSync(absoluteParentDir)) {
        return []
      }

      return fs
        .readdirSync(absoluteParentDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.posix.join(parentDir, entry.name))
        .filter((workspaceDir) =>
          fs.existsSync(path.join(repoRoot, workspaceDir, 'package.json'))
        )
    })
}

function resolveWorkspace(filePath, workspaceDirs) {
  return workspaceDirs.find((workspaceDir) => filePath === workspaceDir || filePath.startsWith(`${workspaceDir}/`))
}

function isIgnoredNonWorkspaceFile(filePath) {
  return (
    filePath === 'README.md' ||
    filePath === '.env.example' ||
    filePath === '.env.local' ||
    filePath === '.env.dev' ||
    filePath === '.env.prod' ||
    filePath.startsWith('_bmad-output/') ||
    filePath.startsWith('docs/')
  )
}

const gitStatusResult = run('git', ['status', '--porcelain'])
const changedPaths = [...new Set(parseChangedPaths(gitStatusResult.stdout ?? ''))]
const workspaceDirs = findWorkspaceDirs()

const changedWorkspaceDirs = new Set()
const unmappedPaths = []

for (const changedPath of changedPaths) {
  const workspaceDir = resolveWorkspace(changedPath, workspaceDirs)
  if (workspaceDir) {
    changedWorkspaceDirs.add(workspaceDir)
    continue
  }

  if (!isIgnoredNonWorkspaceFile(changedPath)) {
    unmappedPaths.push(changedPath)
  }
}

const orderedWorkspaceDirs = [...changedWorkspaceDirs].sort((left, right) =>
  left.localeCompare(right)
)

if (changedPaths.length === 0) {
  console.log('No changed files detected.')
  process.exit(0)
}

if (listOnly) {
  console.log('Changed workspaces:')
  if (orderedWorkspaceDirs.length === 0) {
    console.log('- none')
  } else {
    for (const workspaceDir of orderedWorkspaceDirs) {
      console.log(`- ${workspaceDir}`)
    }
  }

  if (unmappedPaths.length > 0) {
    console.log('\nUnmapped non-workspace changes:')
    for (const unmappedPath of unmappedPaths) {
      console.log(`- ${unmappedPath}`)
    }
  }

  process.exit(0)
}

if (orderedWorkspaceDirs.length === 0) {
  console.log('No changed workspaces detected.')
  if (unmappedPaths.length > 0) {
    console.log('Only non-workspace files changed:')
    for (const unmappedPath of unmappedPaths) {
      console.log(`- ${unmappedPath}`)
    }
  }
  process.exit(0)
}

if (unmappedPaths.length > 0) {
  console.warn('Warning: verify:changed does not automatically verify these non-workspace files:')
  for (const unmappedPath of unmappedPaths) {
    console.warn(`- ${unmappedPath}`)
  }
  console.warn('Run broader root-level checks if those files affect repo-wide behavior.')
}

for (const workspaceDir of orderedWorkspaceDirs) {
  console.log(`\n=== verify:changed -> ${workspaceDir} ===`)
  const result = spawnSync(process.execPath, ['scripts/verify-workspace.mjs', workspaceDir], {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
