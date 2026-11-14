// Learning path Step 55: Expo SDK 58 upgrade for live font-scale layout.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-55-expo-sdk-58-upgrade-for-live-font-scale-layout
//
// CX-06: the mutant narrows exactly expo-modules-core's Module keep rule, and only for
// ModalSystemBarsModule, in a prebuild copy. The dexdump fixtures copy the 2026-11-13 builds:
// the control keeps the constructor, the mutant leaves an abstract shell with no methods.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  MODULE_RULE,
  RULES_FILE,
  TARGET_CLASS,
  applyMutant,
  dexState,
  expoModulesCoreRules,
  narrowModuleKeepRule,
} from './cx06-reflection-mutant.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const shippedRules = fs.readFileSync(
  expoModulesCoreRules(path.join(repoRoot, 'apps/mobile')),
  'utf8'
)
const NARROWED =
  '-keep,allowoptimization,allowobfuscation class !expo.modules.modalsystembars.ModalSystemBarsModule,** extends expo.modules.kotlin.modules.Module {'

test('the shipped expo-modules-core rules narrow to every Module but the target', () => {
  const narrowed = narrowModuleKeepRule(shippedRules)
  assert.equal(narrowed, shippedRules.replace(MODULE_RULE, NARROWED))
  // Every other rule is untouched, the constructor and definition() keeps included.
  assert.match(
    narrowed,
    /public <init>\(\);\n {2}public expo\.modules\.kotlin\.modules\.ModuleDefinitionData definition\(\);/
  )
  assert.throws(
    () => narrowModuleKeepRule(shippedRules.replace(MODULE_RULE, '')),
    /cx06_module_rule_count: 0/
  )
  assert.throws(
    () => narrowModuleKeepRule(`${shippedRules}\n${MODULE_RULE}\n}`),
    /cx06_module_rule_count: 2/
  )
})

test('applying writes the narrowed rules and the build.gradle swap once, outside any checkout', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-cx06-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const android = path.join(root, 'android')
  fs.mkdirSync(android)
  fs.writeFileSync(
    path.join(android, 'build.gradle'),
    'apply plugin: "expo-root-project"\n'
  )
  const rulesSource = path.join(root, 'proguard-rules.pro')
  fs.writeFileSync(rulesSource, shippedRules)

  const applied = applyMutant({ androidRoot: android, rulesSource })
  const rulesPath = path.join(fs.realpathSync(android), RULES_FILE)
  assert.equal(applied.rulesPath, rulesPath)
  assert.ok(fs.readFileSync(rulesPath, 'utf8').includes(NARROWED))
  const gradle = fs.readFileSync(path.join(android, 'build.gradle'), 'utf8')
  assert.match(gradle, /project\(':expo-modules-core'\)/)
  assert.ok(gradle.includes('ext.defaultConfig.consumerProguardFiles.clear()'))
  assert.ok(gradle.includes(JSON.stringify(rulesPath)))
  assert.equal(
    fs.readFileSync(rulesSource, 'utf8'),
    shippedRules,
    'the source is never written'
  )
  assert.throws(
    () => applyMutant({ androidRoot: android, rulesSource }),
    /cx06_already_applied/
  )

  // The repository itself is a git checkout: the mutant refuses it.
  assert.throws(
    () => applyMutant({ androidRoot: path.join(repoRoot, 'apps/mobile'), rulesSource }),
    /cx06_refuses_a_git_checkout/
  )
})

const CONTROL_DEX = `Class #7320            -
  Class descriptor  : 'Lexpo/modules/modalsystembars/ModalSystemBarsModule;'
  Access flags      : 0x0011 (PUBLIC FINAL)
  Superclass        : 'Lexpo/modules/kotlin/modules/Module;'
  Direct methods    -
    #0              : (in Lexpo/modules/modalsystembars/ModalSystemBarsModule;)
      name          : '<init>'
      type          : '()V'
      access        : 0x10001 (PUBLIC CONSTRUCTOR)
  Virtual methods   -
    #0              : (in Lexpo/modules/modalsystembars/ModalSystemBarsModule;)
      name          : 'definition'
      type          : '()Lexpo/modules/kotlin/modules/ModuleDefinitionData;'
Class #7321            -
  Class descriptor  : 'Lexpo/modules/notifications/ModuleNotFoundException;'
  Direct methods    -
    #0              : (in Lexpo/modules/notifications/ModuleNotFoundException;)
      name          : '<init>'
      type          : '()V'
`
const MUTANT_DEX = `Class #7320            -
  Class descriptor  : 'Lexpo/modules/modalsystembars/ModalSystemBarsModule;'
  Access flags      : 0x0401 (PUBLIC ABSTRACT)
  Superclass        : 'Lexpo/modules/kotlin/modules/Module;'
  Interfaces        -
  Static fields     -
  Instance fields   -
  Direct methods    -
  Virtual methods   -
  source_file_idx   : 32700 (ModalSystemBarsModule.kt)

Class #7321            -
  Class descriptor  : 'Lexpo/modules/notifications/ModuleNotFoundException;'
  Direct methods    -
    #0              : (in Lexpo/modules/notifications/ModuleNotFoundException;)
      name          : '<init>'
      type          : '()V'
`

test("dexState reads the target's own constructor, never the next class's", () => {
  assert.equal(TARGET_CLASS, 'expo.modules.modalsystembars.ModalSystemBarsModule')
  assert.deepEqual(dexState(CONTROL_DEX), { class: true, constructor: true })
  assert.deepEqual(dexState(MUTANT_DEX), { class: true, constructor: false })
  assert.deepEqual(dexState(MUTANT_DEX.replace(/ModalSystemBarsModule/g, 'Gone')), {
    class: false,
    constructor: false,
  })
})

// P3-2 (Antigravity r8): a harness that copies android/ alone gets a named error, not a
// createRequire stack.
test('an android copy without its app root fails with a named error', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'couture-cx06-root-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.throws(
    () => expoModulesCoreRules(root),
    /cx06_app_root_missing: .* has no package\.json/
  )
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"copy"}')
  assert.throws(
    () => expoModulesCoreRules(root),
    /cx06_app_root_missing: no node_modules above .* has expo-modules-core/
  )
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'))
  assert.match(
    expoModulesCoreRules(root),
    /expo-modules-core\/android\/proguard-rules\.pro$/
  )
})
