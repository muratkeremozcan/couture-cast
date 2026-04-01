#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nvmrcPath = path.join(repoRoot, '.nvmrc')
const expectedVersion = fs.readFileSync(nvmrcPath, 'utf8').trim()

const expectedMajor = Number.parseInt(expectedVersion, 10)
const actualMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10)

if (Number.isNaN(expectedMajor) || Number.isNaN(actualMajor)) {
  console.error(
    `Unable to verify Node.js version. Expected .nvmrc=${expectedVersion}, actual=${process.versions.node}.`
  )
  process.exit(1)
}

if (actualMajor !== expectedMajor) {
  console.error(
    [
      `This repo requires Node ${expectedMajor}.x for a predictable install/runtime path.`,
      `Current Node: ${process.versions.node}`,
      `Expected baseline: ${expectedVersion} (from .nvmrc)`,
      '',
      `Run "nvm install ${expectedVersion} && nvm use ${expectedVersion}" and try again.`,
    ].join('\n')
  )
  process.exit(1)
}
