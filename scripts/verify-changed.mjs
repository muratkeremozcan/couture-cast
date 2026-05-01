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

function parseChangedPathsNul(output) {
  const records = output.split('\0').filter(Boolean)
  const changedPaths = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const status = record.slice(0, 2)
    const entry = record.slice(3)

    if (status.includes('R') || status.includes('C')) {
      const renamedTarget = records[index + 1]
      if (renamedTarget) {
        changedPaths.push(renamedTarget)
        index += 1
        continue
      }
    }

    changedPaths.push(entry)
  }

  return changedPaths
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
    filePath === '.env.preview' ||
    filePath === '.env.prod' ||
    filePath.startsWith('_bmad-output/') ||
    filePath.startsWith('docs/')
  )
}

const gitStatusResult = run('git', ['status', '--porcelain', '-z'])
const changedPaths = [...new Set(parseChangedPathsNul(gitStatusResult.stdout ?? ''))]
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
