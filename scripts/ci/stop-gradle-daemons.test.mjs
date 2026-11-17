// scripts/ci/stop-gradle-daemons.sh as bash runs it, against real stand-in processes: a Gradle
// wrapper stub, JVM stand-ins started from a throwaway Gradle user home, and one unrelated JVM.
// Diag run 44008046979: the build's daemons held about 5.5 GB through the Google sign-in emulator
// step, the job that lost its runner in run 43964196075.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'

const script = path.resolve('scripts/ci/stop-gradle-daemons.sh')

// Node cannot reap a child while spawnSync blocks, so a stopped child lingers as a zombie: gone
// means no process, or a zombie.
const exited = (child) => {
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(child.pid)], {
    encoding: 'utf8',
  }).stdout.trim()
  return state === '' || state.startsWith('Z')
}

describe('stop-gradle-daemons.sh', () => {
  /**
   * @param {{ gradlewExit?: number, ignoreTerm?: boolean, args?: string[] }} options
   */
  const run = ({ gradlewExit = 0, ignoreTerm = false, args } = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-gradle-daemons-'))
    const children = []
    try {
      const home = path.join(dir, 'home')
      const project = path.join(dir, 'android')
      const bin = path.join(dir, 'bin')
      fs.mkdirSync(path.join(home, '.gradle/caches'), { recursive: true })
      fs.mkdirSync(project)
      fs.mkdirSync(bin)
      // `gradlew --stop` stops the Gradle daemon stand-in, as the real one stops its daemon, and
      // leaves the Kotlin daemon stand-in running.
      fs.writeFileSync(
        path.join(project, 'gradlew'),
        `#!/bin/sh\necho "gradlew $* in $(pwd -P)" >> "${dir}/calls"\nkill "$(cat "${dir}/gradle-daemon.pid")"\nexit ${gradlewExit}\n`,
        { mode: 0o755 }
      )
      // A JVM stand-in: its command line starts with a path ending in java, like a real JVM's.
      const java = path.join(bin, 'java')
      fs.writeFileSync(
        java,
        `#!/bin/sh\n${ignoreTerm ? "trap '' TERM" : "trap 'exit 0' TERM"}\nwhile :; do /bin/sleep 0.1; done\n`,
        { mode: 0o755 }
      )
      const start = (...jvmArgs) => {
        const child = spawn('/bin/sh', [java, ...jvmArgs], { stdio: 'ignore' })
        children.push(child)
        return child
      }
      const gradleDaemon = start(
        '-cp',
        `${home}/.gradle/wrapper/dists/gradle-8.14.3/lib/gradle-daemon-main.jar`,
        'org.gradle.launcher.daemon.bootstrap.GradleDaemon'
      )
      fs.writeFileSync(path.join(dir, 'gradle-daemon.pid'), String(gradleDaemon.pid))
      const kotlinDaemon = start(
        '-cp',
        `${home}/.gradle/caches/modules-2/kotlin-compiler-embeddable-2.1.20.jar`,
        'org.jetbrains.kotlin.daemon.KotlinCompileDaemon'
      )
      const maestro = start('-classpath', `${home}/.maestro/lib/*`, 'maestro.cli.AppKt')
      const result = spawnSync('/bin/bash', [script, ...(args ?? [project])], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: home,
          STOP_GRADLE_GRACE_SECONDS: '1',
        },
      })
      const calls = fs.existsSync(path.join(dir, 'calls'))
        ? fs.readFileSync(path.join(dir, 'calls'), 'utf8')
        : ''
      // The process table settles a moment after a kill.
      const deadline = Date.now() + 3000
      while (
        (!exited(gradleDaemon) || !exited(kotlinDaemon)) &&
        Date.now() < deadline &&
        result.status === 0
      )
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
      return {
        status: result.status,
        output: `${result.stdout}${result.stderr}`,
        calls,
        project: fs.realpathSync(project),
        gradleDaemonGone: exited(gradleDaemon),
        kotlinDaemonGone: exited(kotlinDaemon),
        maestroAlive: !exited(maestro),
      }
    } finally {
      for (const child of children) if (!exited(child)) child.kill('SIGKILL')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  test('stops the Gradle daemon, then the Kotlin daemon gradlew --stop leaves, and nothing else', () => {
    const result = run()
    assert.equal(result.status, 0, result.output)
    assert.equal(result.calls.trim(), `gradlew --stop in ${result.project}`)
    assert.equal(result.gradleDaemonGone, true)
    assert.equal(result.kotlinDaemonGone, true)
    assert.equal(
      result.maestroAlive,
      true,
      'a JVM outside the Gradle user home keeps running'
    )
    assert.match(result.output, /No Gradle, Kotlin or worker JVM is left running\./)
  })

  test('kills a build JVM that ignores SIGTERM', () => {
    const result = run({ ignoreTerm: true })
    assert.equal(result.status, 0, result.output)
    assert.equal(result.kotlinDaemonGone, true)
    assert.equal(result.maestroAlive, true)
  })

  test('fails when gradlew --stop fails', () => {
    const result = run({ gradlewExit: 1 })
    assert.notEqual(result.status, 0)
  })

  test('requires the Android project directory', () => {
    assert.equal(run({ args: [] }).status, 2)
  })
})
