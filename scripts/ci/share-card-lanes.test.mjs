import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { parse } from 'yaml'
import {
  android36Lanes,
  gateJobName,
  shareCardLaneProblems,
} from './share-card-lanes.mjs'

const source = parse(
  fs.readFileSync('.github/workflows/pr-share-card-native.yml', 'utf8')
)
// JSON round trip breaks the sharing YAML aliases create, so one lane can be mutated alone.
const fresh = () => JSON.parse(JSON.stringify(source))
const mutate = (change) => {
  const workflow = fresh()
  change(workflow.jobs, workflow)
  return shareCardLaneProblems(workflow)
}
const step = (job, predicate) => job.steps.find(predicate)
const native = ['android36-native-matrix', 'android36-original', 'android36-interaction']
const deviceLanes = Object.keys(android36Lanes).filter(
  (name) => name !== 'browser-acceptance'
)

describe('share-card parallel lane validator', () => {
  test('the committed workflow passes', () => {
    assert.deepEqual(shareCardLaneProblems(source), [])
    assert.deepEqual(
      Object.keys(android36Lanes).sort(),
      [...native, 'browser-acceptance'].sort()
    )
  })

  const controls = [
    [
      'removing any lane job',
      /required parallel job missing/,
      (jobs, name) => delete jobs[name],
    ],
    [
      'serializing any lane behind a dependency',
      /start independently/,
      (jobs, name) => (jobs[name].needs = ['original-resource']),
    ],
    [
      'gating any lane on another condition',
      /device lane must be skipped on pull_request|pull request lane cannot be conditional/,
      (jobs, name) => (jobs[name].if = 'success()'),
    ],
    [
      'running any lane on every event',
      /device lane must be skipped on pull_request/,
      (jobs, name) => delete jobs[name].if,
      deviceLanes,
    ],
    [
      'skipping the pull request lane',
      /pull request lane cannot be conditional/,
      (jobs, name) => (jobs[name].if = "github.event_name != 'pull_request'"),
      ['browser-acceptance'],
    ],
    [
      'running any lane on a non-free runner',
      /free Ubuntu runner/,
      (jobs, name) => (jobs[name]['runs-on'] = 'ubuntu-latest-xl'),
    ],
    [
      'letting any lane failure continue',
      /failures must remain visible/,
      (jobs, name) => (jobs[name]['continue-on-error'] = true),
    ],
    [
      'hiding a step failure in any lane',
      /steps cannot hide failures/,
      (jobs, name) => (jobs[name].steps[3]['continue-on-error'] = true),
    ],
    [
      'enabling fail-fast in any lane',
      /preserve sibling evidence/,
      (jobs, name) => (jobs[name].strategy['fail-fast'] = true),
    ],
    [
      'changing any lane API',
      /exact API36 partition/,
      (jobs, name) => (jobs[name].strategy.matrix.include[0].api = 32),
    ],
    [
      'changing any lane suite',
      /exact API36 partition/,
      (jobs, name) => (jobs[name].strategy.matrix.include[0].suite = 'all'),
    ],
    [
      'raising any lane past 90 minutes',
      /within 90 minutes/,
      (jobs, name) => (jobs[name]['timeout-minutes'] = 91),
    ],
    [
      'removing any lane limit',
      /within 90 minutes/,
      (jobs, name) => delete jobs[name]['timeout-minutes'],
    ],
    [
      're-enabling the shared database reset in any lane',
      /database reset must remain disabled/,
      (jobs, name) => (jobs[name].env.PLAYWRIGHT_SKIP_DB_RESET = 'false'),
    ],
    [
      'dropping local services from any lane',
      /own local services/,
      (jobs, name) =>
        (jobs[name].steps = jobs[name].steps.filter(
          (row) => row.uses !== './.github/actions/start-local-supabase'
        )),
    ],
    [
      'dropping the UUID runtime from any lane',
      /own UUID database, auth and API/,
      (jobs, name) => (step(jobs[name], (row) => row.id === 'runtime').run = 'true'),
    ],
    [
      'dropping cleanup from any lane',
      /owned cleanup must always run/,
      (jobs, name) =>
        (jobs[name].steps = jobs[name].steps.filter(
          (row) => row.run !== 'node scripts/e2e-share-card/cleanup.mjs'
        )),
    ],
    [
      'making cleanup conditional in any lane',
      /owned cleanup must always run/,
      (jobs, name) =>
        (step(
          jobs[name],
          (row) => row.run === 'node scripts/e2e-share-card/cleanup.mjs'
        ).if = '${{ success() }}'),
    ],
    [
      'dropping evidence selection from any lane',
      /closed evidence must always be selected/,
      (jobs, name) =>
        (jobs[name].steps = jobs[name].steps.filter(
          (row) => row.run !== 'node scripts/e2e-share-card/public-evidence.mjs'
        )),
    ],
    [
      'letting any upload tolerate missing files',
      /evidence upload must fail closed/,
      (jobs, name) =>
        (step(jobs[name], (row) => row.uses === 'actions/upload-artifact@v4').with[
          'if-no-files-found'
        ] = 'warn'),
    ],
    [
      'skipping the upload after failure in any lane',
      /evidence upload must fail closed/,
      (jobs, name) =>
        (step(jobs[name], (row) => row.uses === 'actions/upload-artifact@v4').if =
          'success()'),
    ],
  ]
  for (const [title, expected, change, lanes = Object.keys(android36Lanes)] of controls)
    for (const name of lanes)
      test(`${title}: ${name}`, () => {
        const problems = mutate((jobs) => change(jobs, name))
        assert.ok(
          problems.some((problem) => expected.test(problem)),
          problems.join('\n') || 'no problem raised'
        )
        // The control is attributed to the mutated lane or the aggregate, never silently dropped.
        assert.ok(problems.length >= 1)
      })

  test('colliding artifact names across lanes is rejected', () => {
    const problems = mutate((jobs) => {
      step(
        jobs['android36-original'],
        (row) => row.uses === 'actions/upload-artifact@v4'
      ).with.name = 'share-card-${{ matrix.platform }}-${{ matrix.api }}'
      step(
        jobs['android36-interaction'],
        (row) => row.uses === 'actions/upload-artifact@v4'
      ).with.name = 'share-card-${{ matrix.platform }}-${{ matrix.api }}'
    })
    assert.ok(
      problems.some((problem) => /artifact name must be unique/.test(problem)),
      problems.join('\n')
    )
  })

  describe('aggregate gate', () => {
    test('uses a name distinct from the required ruleset context gate', () => {
      assert.equal(gateJobName, 'share-card-lanes-gate')
      assert.equal(source.jobs.gate, undefined)
      assert.equal(source.jobs[gateJobName].name, gateJobName)
      assert.equal(
        Object.values(source.jobs).some((job) => job.name === 'gate'),
        false
      )
    })

    for (const [title, change] of [
      [
        'a job id named gate',
        (jobs) => (jobs.gate = { 'runs-on': 'ubuntu-latest', steps: [] }),
      ],
      [
        'renaming the aggregate job back to gate by id',
        (jobs) => {
          jobs.gate = jobs[gateJobName]
          delete jobs[gateJobName]
        },
      ],
      ['a job whose display name is gate', (jobs) => (jobs[gateJobName].name = 'gate')],
      [
        'any other job whose display name is gate',
        (jobs) => (jobs['android36-original'].name = 'gate'),
      ],
    ])
      test(`${title} is rejected`, () => {
        const problems = mutate(change)
        assert.ok(
          problems.some((problem) => /required ruleset context/.test(problem)),
          problems.join('\n') || 'no problem raised'
        )
      })

    describe('workflow triggers', () => {
      const mutateOn = (change) => {
        const workflow = fresh()
        change(workflow.on)
        return shareCardLaneProblems(workflow)
      }
      for (const [title, expected, change] of [
        ['no pull_request trigger', /must trigger on/, (on) => delete on.pull_request],
        ['no push trigger', /must trigger on/, (on) => delete on.push],
        [
          'a push trigger beyond main',
          /must trigger on/,
          (on) => (on.push.branches = ['*']),
        ],
        ['no dispatch trigger', /must trigger on/, (on) => delete on.workflow_dispatch],
        ['no nightly schedule', /nightly schedule/, (on) => delete on.schedule],
        ['an empty schedule', /nightly schedule/, (on) => (on.schedule = [])],
        [
          'a malformed cron',
          /nightly schedule/,
          (on) => (on.schedule = [{ cron: 'nightly' }]),
        ],
      ])
        test(`${title} is rejected`, () => {
          const problems = mutateOn(change)
          assert.ok(
            problems.some((problem) => expected.test(problem)),
            problems.join('\n') || 'no problem raised'
          )
        })

      test('the committed triggers are pull_request, main, nightly and dispatch', () => {
        assert.deepEqual(Object.keys(source.on).sort(), [
          'pull_request',
          'push',
          'schedule',
          'workflow_dispatch',
        ])
        assert.equal(source.jobs['browser-acceptance'].if, undefined)
      })
    })

    test('a missing aggregate job is rejected', () => {
      const problems = mutate((jobs) => delete jobs[gateJobName])
      assert.ok(problems.some((problem) => /run after failure/.test(problem)))
    })

    test('the gate receives the triggering event', () => {
      const gateStep = source.jobs[gateJobName].steps.at(-1)
      assert.equal(gateStep.env.CC68_EVENT_NAME, '${{ github.event_name }}')
    })

    for (const [title, expected, change] of [
      [
        'not telling the script which event triggered it',
        /triggering event/,
        (jobs) => delete jobs[gateJobName].steps.at(-1).env.CC68_EVENT_NAME,
      ],
      [
        'telling the script a constant event',
        /triggering event/,
        (jobs) => (jobs[gateJobName].steps.at(-1).env.CC68_EVENT_NAME = 'push'),
      ],
      [
        'dropping a lane from needs',
        /require every browser and native partition/,
        (jobs) => (jobs[gateJobName].needs = jobs[gateJobName].needs.slice(1)),
      ],
      [
        'dropping the legacy lane from needs',
        /require every browser and native partition/,
        (jobs) =>
          (jobs[gateJobName].needs = jobs[gateJobName].needs.filter(
            (n) => n !== 'original-resource'
          )),
      ],
      [
        'adding an unknown dependency',
        /require every browser and native partition/,
        (jobs) => jobs[gateJobName].needs.push('unknown-job'),
      ],
      [
        'running only on success',
        /run after failure and cancellation/,
        (jobs) => delete jobs[gateJobName].if,
      ],
      [
        'continuing on error',
        /cannot hide failure/,
        (jobs) => (jobs[gateJobName]['continue-on-error'] = true),
      ],
      [
        'skipping the results script',
        /actual dependency results/,
        (jobs) =>
          (jobs[gateJobName].steps = jobs[gateJobName].steps.filter((row) => !row.run)),
      ],
      [
        'feeding the script a constant',
        /actual dependency results/,
        (jobs) => (jobs[gateJobName].steps.at(-1).env.CC68_JOB_RESULTS = '{}'),
      ],
      [
        'bypassing the script step',
        /actual dependency results/,
        (jobs) => (jobs[gateJobName].steps.at(-1)['continue-on-error'] = true),
      ],
      [
        'conditioning the script step',
        /actual dependency results/,
        (jobs) => (jobs[gateJobName].steps.at(-1).if = 'false'),
      ],
    ])
      test(`${title} is rejected`, () => {
        const problems = mutate(change)
        assert.ok(
          problems.some((problem) => expected.test(problem)),
          problems.join('\n') || 'no problem raised'
        )
      })
  })

  describe('browser lane', () => {
    const browser = (jobs) => jobs['browser-acceptance']
    for (const [title, expected, change] of [
      [
        'provisioning only Chromium',
        /all three pinned browsers/,
        (jobs) =>
          (step(browser(jobs), (row) => row.id === 'browser_deps').run =
            'node scripts/ci/share-card-browser-deps.mjs --chromium-only'),
      ],
      [
        'adding an emulator',
        /avoid native preparation/,
        (jobs) =>
          browser(jobs).steps.push({ uses: 'reactivecircus/android-emulator-runner@v2' }),
      ],
      [
        'adding Java',
        /avoid native preparation/,
        (jobs) => browser(jobs).steps.push({ uses: 'actions/setup-java@v4' }),
      ],
      [
        'adding the Android SDK',
        /avoid native preparation/,
        (jobs) => browser(jobs).steps.push({ uses: 'android-actions/setup-android@v3' }),
      ],
      [
        'adding a native build',
        /avoid native preparation/,
        (jobs) =>
          browser(jobs).steps.push({
            run: 'node scripts/run-story68-native.mjs build --platform android',
          }),
      ],
      [
        'adding Metro to the runtime',
        /avoid native preparation/,
        (jobs) =>
          (step(browser(jobs), (row) => row.id === 'runtime').run +=
            '\nnode scripts/run-story68-native.mjs metro > /tmp/cc68-metro.log'),
      ],
      [
        'dropping the matrix validator',
        /complete browser matrix validator/,
        (jobs) =>
          (step(browser(jobs), (row) => row.run?.includes('npx playwright test')).run =
            'npx playwright test --config playwright/share-card.config.ts'),
      ],
      [
        'dropping the production build',
        /complete browser matrix validator/,
        (jobs) =>
          (step(browser(jobs), (row) => row.run?.includes('npx playwright test')).run =
            step(browser(jobs), (row) =>
              row.run?.includes('npx playwright test')
            ).run.replace('web.mjs build', 'web.mjs dev')),
      ],
      [
        'dropping the browser matrix',
        /complete browser matrix validator/,
        (jobs) =>
          (browser(jobs).steps = browser(jobs).steps.filter(
            (row) => !row.run?.includes('npx playwright test')
          )),
      ],
    ])
      test(`${title} is rejected`, () => {
        const problems = mutate(change)
        assert.ok(
          problems.some((problem) => expected.test(problem)),
          problems.join('\n') || 'no problem raised'
        )
      })
  })

  describe('native lanes', () => {
    for (const name of native)
      for (const [title, expected, change] of [
        [
          'provisioning every browser engine',
          /Chromium bridge prerequisite/,
          (job) =>
            (step(job, (row) => row.id === 'browser_deps').run =
              'node scripts/ci/share-card-browser-deps.mjs'),
        ],
        [
          'dropping Metro and Maestro',
          /own Metro and Maestro/,
          (job) =>
            (step(job, (row) => row.id === 'runtime').run = step(
              job,
              (row) => row.id === 'runtime'
            ).run.replace(/.*(metro|maestro).*\n?/g, '')),
        ],
        [
          'dropping the native build',
          /native build and accessibility bridge/,
          (job) =>
            (job.steps = job.steps.filter(
              (row) => !row.run?.includes('run-story68-native.mjs build')
            )),
        ],
        [
          'dropping the accessibility bridge',
          /native build and accessibility bridge/,
          (job) =>
            (job.steps = job.steps.filter(
              (row) => !row.run?.includes('bridge-a11y.mjs')
            )),
        ],
        [
          'dropping the suite environment',
          /exact API, suite and free-runner emulator/,
          (job) =>
            delete step(job, (row) => row.uses?.startsWith('reactivecircus/')).env
              .CC68_ANDROID_SUITE,
        ],
        [
          'running a different journey script',
          /exact API, suite and free-runner emulator/,
          (job) =>
            (step(job, (row) => row.uses?.startsWith('reactivecircus/')).with.script =
              'bash scripts/ci/other.sh'),
        ],
        [
          'using a non-Play image',
          /actual TalkBack system image/,
          (job) => (job.strategy.matrix.include[0].target = 'google_apis'),
        ],
        [
          'removing the journey limit',
          /leave preparation and cleanup budget/,
          (job) =>
            delete step(job, (row) => row.uses?.startsWith('reactivecircus/'))[
              'timeout-minutes'
            ],
        ],
        [
          'crowding preparation out of the job limit',
          /leave preparation and cleanup budget/,
          (job) =>
            (job.strategy.matrix.include[0].journey_timeout =
              job['timeout-minutes'] - 10),
        ],
        [
          'running the browser matrix natively',
          /browser matrix belongs to its independent job/,
          (job) =>
            job.steps.push({
              run: 'npx playwright test --config playwright/share-card.config.ts',
            }),
        ],
      ])
        test(`${title} in ${name} is rejected`, () => {
          const problems = mutate((jobs) => change(jobs[name]))
          assert.ok(
            problems.some((problem) => expected.test(problem)),
            problems.join('\n') || 'no problem raised'
          )
        })
  })

  test('the legacy API32 row must stay complete and alone', () => {
    for (const change of [
      (rows) => rows.pop(),
      (rows) => (rows[0].suite = 'matrix'),
      (rows) =>
        rows.push({ os: 'macos-15-intel', platform: 'ios', api: 0, suite: 'all' }),
    ]) {
      const problems = mutate((jobs) =>
        change(jobs['original-resource'].strategy.matrix.include)
      )
      assert.ok(
        problems.some((problem) => /legacy API32 journey must remain/.test(problem)),
        problems.join('\n')
      )
    }
  })

  describe('iOS journey', () => {
    const iosJobs = ['ios-build', 'ios-shard', 'ios-expo-go', 'ios-evidence']
    const rejected = (title, expected, change) =>
      test(`${title} is rejected`, () => {
        const problems = mutate(change)
        assert.ok(
          problems.some((problem) => expected.test(problem)),
          problems.join('\n') || 'no problem raised'
        )
      })
    for (const name of iosJobs)
      rejected(
        `removing ${name}`,
        /required iOS job missing/,
        (jobs) => delete jobs[name]
      )
    rejected('the retired Intel runner', /Intel macOS runner is retired/, (jobs) => {
      jobs['ios-shard']['runs-on'] = 'macos-15-intel'
    })
    rejected('a longer ios-shard limit', /ios-shard: independent limit/, (jobs) => {
      jobs['ios-shard']['timeout-minutes'] = 151
    })
    rejected('an ios-shard that does not need the build', /exactly ios-build/, (jobs) => {
      delete jobs['ios-shard'].needs
    })
    rejected(
      'a build that waits on something',
      /ios-build must start independently/,
      (jobs) => {
        jobs['ios-build'].needs = ['original-resource']
      }
    )
    rejected('a single shard', /shards 1 and 2/, (jobs) => {
      jobs['ios-shard'].strategy.matrix.shard = [1]
    })
    rejected('a shard matrix that cancels its sibling', /shards 1 and 2/, (jobs) => {
      delete jobs['ios-shard'].strategy['fail-fast']
    })
    rejected(
      'an evidence job skipped after a failed shard',
      /ios-evidence must run after/,
      (jobs) => {
        jobs['ios-evidence'].if = "github.event_name != 'pull_request'"
      }
    )
    rejected(
      'an evidence job that also runs on pull_request',
      /ios-evidence must run after/,
      (jobs) => {
        jobs['ios-evidence'].if = 'always()'
      }
    )
    for (const name of ['ios-build', 'ios-shard'])
      rejected(
        `${name} running on pull_request`,
        new RegExp(`${name} must be skipped on pull_request`),
        (jobs) => {
          delete jobs[name].if
        }
      )
    rejected(
      'an evidence job that does not check the shard result',
      /exact cases/,
      (jobs) => {
        jobs['ios-evidence'].steps = jobs['ios-evidence'].steps.filter(
          (row) => !row.run?.includes('CC68_SHARD_RESULT')
        )
      }
    )
    rejected('a shard command without its shard', /receive its shard/, (jobs) => {
      const row = step(jobs['ios-shard'], (item) =>
        item.run?.includes('--shard "$shard"')
      )
      row.run = row.run.replace('--shard "$shard"', '')
    })
    rejected(
      'uploading the app before the secret scan',
      /secret-scanned before/,
      (jobs) => {
        const steps = jobs['ios-build'].steps
        const at = steps.findIndex((row) =>
          row.run?.includes('native-ios-app-secret-scan')
        )
        steps.splice(at, 1)
      }
    )
    rejected(
      'an ios-shard without the harness directory env',
      /ios-shard: the harness directory env is required/,
      (jobs) => {
        delete jobs['ios-shard'].env
      }
    )
    for (const name of ['ios-build', 'ios-shard', 'ios-expo-go'])
      rejected(
        `an evidence upload of a broader path in ${name}`,
        /evidence upload must fail closed/,
        (jobs) => {
          const row = jobs[name].steps.find(
            (item) =>
              item.uses === 'actions/upload-artifact@v4' &&
              String(item.with?.path).includes('public-evidence')
          )
          row.with.path = '_bmad-output/test-artifacts/story-6-8/runtime/'
        }
      )
    rejected(
      'an ios-expo-go without the harness directory env',
      /ios-expo-go: the harness directory env is required/,
      (jobs) => {
        delete jobs['ios-expo-go'].env
      }
    )
    rejected(
      'an ios-expo-go limit over the iOS bound',
      /ios-expo-go: independent limit/,
      (jobs) => {
        jobs['ios-expo-go']['timeout-minutes'] = 151
      }
    )
    rejected(
      'an ios-expo-go on pull_request',
      /ios-expo-go must skip pull requests like the other device lanes/,
      (jobs) => {
        delete jobs['ios-expo-go'].if
      }
    )
    rejected(
      'an ios-expo-go that skips main pushes',
      /ios-expo-go must skip pull requests like the other device lanes/,
      (jobs) => {
        jobs['ios-expo-go'].if =
          "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"
      }
    )
    rejected(
      'an ios-expo-go without the build',
      /ios-expo-go must need exactly ios-build/,
      (jobs) => {
        jobs['ios-expo-go'].needs = ['ios-build', 'ios-shard']
      }
    )
    rejected('an ios-expo-go matrix', /not in a matrix/, (jobs) => {
      jobs['ios-expo-go'].strategy = { matrix: { shard: [1, 2] } }
    })
    rejected(
      'an ios-expo-go that never runs the proof',
      /the proof must run once/,
      (jobs) => {
        jobs['ios-expo-go'].steps = jobs['ios-expo-go'].steps.filter(
          (row) => !row.run?.includes('expo-go-proof')
        )
      }
    )
    rejected('an ios-expo-go proof with a shard', /without a shard/, (jobs) => {
      const row = step(jobs['ios-expo-go'], (item) => item.run?.includes('expo-go-proof'))
      row.run = row.run.replace('--device "$device"', '--device "$device" --shard 2/2')
    })
    rejected(
      'an ios-shard that runs the Expo Go proof',
      /ios-shard must not run the Expo Go proof/,
      (jobs) => {
        const row = step(jobs['ios-shard'], (item) => item.name === 'iOS shard flows')
        row.run += '\nnode scripts/run-story68-native.mjs expo-go-proof --platform ios\n'
      }
    )
    rejected(
      'an ios-expo-go setup that drifted from the shard',
      /step for step/,
      (jobs) => {
        const row = step(
          jobs['ios-expo-go'],
          (item) => item.name === 'Install the iOS project generator'
        )
        row.run = 'brew install xcodegen --head'
      }
    )
    rejected(
      'a lanes gate without the Expo Go job',
      /gate must require every/,
      (jobs) => {
        jobs[gateJobName].needs = jobs[gateJobName].needs.filter(
          (name) => name !== 'ios-expo-go'
        )
      }
    )
    rejected(
      'an app scan without the harness directory env',
      /scan must run with the harness directory/,
      (jobs) => {
        delete jobs['ios-build'].env
      }
    )
    rejected(
      'an app scan with an empty harness argument',
      /scan must run with the harness directory/,
      (jobs) => {
        const row = step(jobs['ios-build'], (item) =>
          item.run?.includes('native-ios-app-secret-scan')
        )
        row.run = row.run.replace('"$CC68_HARNESS_DIR"', '""')
      }
    )
    for (const [title, change] of [
      [
        'uploading a broader path than the packaged app',
        (jobs) => {
          step(jobs['ios-build'], (row) => row.with?.name === 'cc68-ios-app').with.path =
            '/tmp/'
        },
      ],
      [
        'packaging something besides the app',
        (jobs) => {
          const row = step(jobs['ios-build'], (item) =>
            item.run?.includes('-cf /tmp/cc68-ios-app.tar')
          )
          row.run = row.run.replace('CoutureCastStory68.app', '.')
        },
      ],
      [
        'scanning a different directory than the one packaged',
        (jobs) => {
          const row = step(jobs['ios-build'], (item) =>
            item.run?.includes('native-ios-app-secret-scan')
          )
          row.run = row.run.replace('/CoutureCastStory68.app', '')
        },
      ],
    ])
      rejected(title, /must be the scanned app, packaged to its one pinned path/, change)
    rejected(
      'keeping the app artifact for longer',
      /app artifact keeps one day/,
      (jobs) => {
        step(jobs['ios-build'], (row) => row.with?.name === 'cc68-ios-app').with[
          'retention-days'
        ] = 7
      }
    )
    for (const path of [
      '_bmad-output/test-artifacts/story-6-8/runtime/native-ios-startup-private.json',
      '_bmad-output/test-artifacts/story-6-8/runtime/native-ios-sampler-private.json',
      '_bmad-output/test-artifacts/story-6-8/runtime/native-host-snapshot-private.json',
      '_bmad-output/test-artifacts/story-6-8/runtime/native-ios-device.json',
      '/tmp/cc68-metro.log',
      '_bmad-output/test-artifacts/story-6-8/runtime/owned-env.json',
    ])
      for (const name of [...iosJobs, 'original-resource', 'android36-original'])
        rejected(
          `uploading ${path.split('/').pop()} from ${name}`,
          /may not name a private/,
          (jobs) => {
            jobs[name].steps.push({
              uses: 'actions/upload-artifact@v4',
              with: { name: 'extra', path },
            })
          }
        )
    for (const name of [
      'original-resource',
      'android36-native-matrix',
      'ios-build',
      'ios-shard',
      'ios-expo-go',
    ])
      rejected(
        `a Metro start without --platform in ${name}`,
        /Metro start must pass --platform/,
        (jobs) => {
          jobs[name].steps.push({
            run: 'node scripts/run-story68-native.mjs metro > /tmp/m.log',
          })
        }
      )
  })

  test('giving the legacy API32 journey a new step timeout is rejected', () => {
    for (const change of [
      (jobs) =>
        (jobs['original-resource'].strategy.matrix.include[0].journey_timeout = 65),
      (jobs) =>
        (jobs['original-resource'].steps.find(
          (row) => row.uses === 'reactivecircus/android-emulator-runner@v2'
        )['timeout-minutes'] = 65),
    ]) {
      const problems = mutate(change)
      assert.ok(
        problems.some((problem) => /must not gain a step timeout/.test(problem)),
        problems.join('\n') || 'no problem raised'
      )
    }
    const row = source.jobs['original-resource'].strategy.matrix.include
    assert.equal(
      row.some((item) => item.journey_timeout !== undefined),
      false
    )
  })

  test('raising the legacy 90 minute limit is rejected', () => {
    const problems = mutate(
      (jobs) => (jobs['original-resource']['timeout-minutes'] = 120)
    )
    assert.ok(
      problems.some((problem) => /existing 90 minute limit/.test(problem)),
      problems.join('\n')
    )
  })

  test('the Android36 native lanes share one step list yet never mutate each other', () => {
    assert.deepEqual(
      source.jobs['android36-original'].steps,
      source.jobs['android36-interaction'].steps
    )
    assert.deepEqual(
      source.jobs['android36-native-matrix'].steps,
      source.jobs['android36-interaction'].steps
    )
    const problems = mutate(
      (jobs) => (jobs['android36-original'].steps[0].id = 'changed')
    )
    assert.deepEqual(problems, [])
  })
})

/** Runs one step's script with stub tools on PATH; returns the exit status. */
const runWithStubs = (row, stubs) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'share-native-unit-'))
  try {
    const bin = path.join(scratch, 'bin')
    fs.mkdirSync(bin)
    for (const [name, body] of Object.entries(stubs)) {
      fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, {
        mode: 0o755,
      })
    }
    const cwd = path.join(scratch, row['working-directory'] ?? '.')
    fs.mkdirSync(cwd, { recursive: true })
    return spawnSync('bash', ['-c', row.run], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: scratch },
    }).status
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
// XCTest's own summary; with skips it reads "with S tests skipped and F failures".
const swiftSummary = (count, failures = 0, skipped = 0) =>
  `echo "Test Suite 'All tests' passed."; echo "\t Executed ${plural(count, 'test')}, with ${skipped ? `${plural(skipped, 'test')} skipped and ` : ''}${plural(failures, 'failure')} (0 unexpected) in 0.1 (0.1) seconds"; exit ${failures ? 1 : 0}`

// U-HARNESS-PR-WORKFLOW: the share native unit lane runs on every PR that touches either native
// share-card module, each test step fails on zero tests, and no job outlives the PR budget.
describe('share native unit workflow', () => {
  const unit = parse(
    fs.readFileSync('.github/workflows/pr-share-native-unit.yml', 'utf8')
  )
  const paths = [
    'apps/mobile/modules/share-card-native-share/**',
    'apps/mobile/modules/share-card-photo-save/**',
    '.github/workflows/pr-share-native-unit.yml',
  ]
  const testSteps = Object.values(unit.jobs).flatMap((job) =>
    job.steps.filter((row) => /swift test|testDebugUnitTest/.test(row.run ?? ''))
  )

  /** One JUnit XML report per entry: a test count, or [tests, skipped]. */
  const gradleReports = (counts, status = 0) =>
    [
      'dir=apps/mobile/modules/share-card-native-share/android/unit-tests/build/test-results/testDebugUnitTest',
      'mkdir -p "$dir"',
      ...counts.map((entry, index) => {
        const [count, skipped] = Array.isArray(entry) ? entry : [entry, 0]
        return `echo '<?xml version="1.0"?><testsuite name="S${index}" tests="${count}" skipped="${skipped}" failures="0" errors="0" timestamp="2026-10-30T12:00:00"></testsuite>' > "$dir/TEST-S${index}.xml"`
      }),
      `exit ${status}`,
    ].join('\n')

  test('runs on pull requests, main, nightly and on demand for both modules', () => {
    // The YAML `on` key parses as the string "on".
    const on = unit.on
    assert.deepEqual(on.pull_request.paths, paths)
    assert.deepEqual(on.push.paths, paths)
    assert.deepEqual(on.push.branches, ['main'])
    assert.equal(on.schedule.length, 1)
    assert.ok('workflow_dispatch' in on)
  })

  test('every job is unconditional, visible on failure and within 20 minutes', () => {
    const jobs = Object.entries(unit.jobs)
    assert.deepEqual(jobs.map(([name]) => name).sort(), ['robolectric', 'swift'])
    for (const [name, job] of jobs) {
      assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 20, name)
      assert.equal(job.if, undefined, `${name} runs on pull requests`)
      assert.notEqual(job['continue-on-error'], true, name)
      assert.ok(
        job.steps.every((row) => row['continue-on-error'] !== true),
        name
      )
    }
  })

  test('tests both Swift packages and the standalone Robolectric project', () => {
    const swift = unit.jobs.swift.steps.filter((row) => /swift test/.test(row.run ?? ''))
    assert.deepEqual(
      swift.map((row) => row['working-directory']),
      [
        'apps/mobile/modules/share-card-native-share/ios',
        'apps/mobile/modules/share-card-photo-save/ios',
      ]
    )
    const gradle = unit.jobs.robolectric.steps.filter((row) =>
      /testDebugUnitTest/.test(row.run ?? '')
    )
    assert.equal(gradle.length, 1)
    assert.match(
      gradle[0].run,
      /apps\/mobile\/modules\/share-card-native-share\/android\/unit-tests/
    )
    assert.equal(
      unit.jobs.robolectric.steps.find((row) =>
        row.uses?.startsWith('actions/setup-java')
      ).with['java-version'],
      '21'
    )
    assert.equal(testSteps.length, 3)
  })

  test('each test step passes with tests and fails on zero tests, all skipped or a failure', () => {
    for (const row of testSteps) {
      const swift = /swift test/.test(row.run)
      const tool = swift ? 'swift' : 'gradle'
      const pass = swift ? swiftSummary(21) : gradleReports([4, 11])
      assert.equal(runWithStubs(row, { [tool]: pass }), 0, `${row.name} passes`)
      if (swift) assert.equal(runWithStubs(row, { swift: swiftSummary(1) }), 0, row.name)
      const zero = swift
        ? [swiftSummary(0), 'echo "no summary"', 'exit 0']
        : [gradleReports([]), gradleReports([0, 0]), 'exit 0']
      for (const body of zero) {
        assert.notEqual(runWithStubs(row, { [tool]: body }), 0, `${row.name}: zero tests`)
      }
      // Skipped tests did not run: an all-skipped run is a zero-test run, a partial one passes.
      const allSkipped = swift
        ? [swiftSummary(21, 0, 21), swiftSummary(1, 0, 1)]
        : [
            gradleReports([
              [4, 4],
              [11, 11],
            ]),
            gradleReports([[1, 1]]),
          ]
      for (const body of allSkipped) {
        assert.notEqual(
          runWithStubs(row, { [tool]: body }),
          0,
          `${row.name}: all skipped`
        )
      }
      const partlySkipped = swift
        ? swiftSummary(21, 0, 20)
        : gradleReports([
            [4, 4],
            [11, 10],
          ])
      assert.equal(
        runWithStubs(row, { [tool]: partlySkipped }),
        0,
        `${row.name}: one test ran`
      )
      const failing = swift ? swiftSummary(21, 1) : gradleReports([4], 1)
      assert.notEqual(runWithStubs(row, { [tool]: failing }), 0, `${row.name}: failure`)
    }
  })
})

describe('ios-build photo-save guard', () => {
  const guard = step(source.jobs['ios-build'], (row) => row.id === 'png_file_guards')

  test('passes on any nonzero count and fails on zero tests, a skip or a failure', () => {
    // A literal count breaks the lane whenever the suite grows.
    assert.doesNotMatch(guard.run, /Executed \d+ tests/)
    for (const count of [1, 4, 5, 21])
      assert.equal(
        runWithStubs(guard, { swift: swiftSummary(count) }),
        0,
        `${count} tests`
      )
    const skipped =
      'echo "\t Executed 5 tests, with 1 test skipped and 0 failures (0 unexpected) in 0.1 (0.1) seconds"'
    for (const body of [swiftSummary(0), 'echo "no summary"', 'exit 0', skipped])
      assert.notEqual(runWithStubs(guard, { swift: body }), 0, body)
    assert.notEqual(runWithStubs(guard, { swift: swiftSummary(5, 1) }), 0, 'failure')
    // A failure summary from a tool that still exits zero.
    assert.notEqual(
      runWithStubs(guard, {
        swift: swiftSummary(5, 1).replace(/exit \d+$/, 'exit 0'),
      }),
      0,
      'failure with exit 0'
    )
  })
})
