import assert from 'node:assert/strict'
import fs from 'node:fs'
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
      (jobs, name) => (jobs[name].needs = ['supabase-images']),
    ],
    [
      'gating any lane on a condition',
      /start independently/,
      (jobs, name) => (jobs[name].if = 'success()'),
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
  for (const [title, expected, change] of controls)
    for (const name of Object.keys(android36Lanes))
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

    test('a missing aggregate job is rejected', () => {
      const problems = mutate((jobs) => delete jobs[gateJobName])
      assert.ok(problems.some((problem) => /run after failure/.test(problem)))
    })

    for (const [title, expected, change] of [
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
        (jobs) => jobs[gateJobName].needs.push('supabase-images'),
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

  test('the legacy API32 and iOS rows must stay complete', () => {
    for (const change of [
      (rows) => rows.pop(),
      (rows) => (rows[0].suite = 'matrix'),
      (rows) => (rows[1].platform = 'android'),
    ]) {
      const problems = mutate((jobs) =>
        change(jobs['original-resource'].strategy.matrix.include)
      )
      assert.ok(
        problems.some((problem) => /legacy API32 and iOS journeys/.test(problem)),
        problems.join('\n')
      )
    }
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
