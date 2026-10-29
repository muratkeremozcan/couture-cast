import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Reanimated 4.1 imports Worklets' legacy cmake path. AGP publishes the actual
// binary through each CMake task's soFolder. Select that exact output.
const initScript = (selection) => `
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import java.security.MessageDigest
import java.nio.file.Files
import java.nio.file.StandardCopyOption

def selection = new JsonSlurper().parseText(new String('${Buffer.from(JSON.stringify(selection)).toString('base64')}'.decodeBase64(), 'UTF-8'))
gradle.projectsEvaluated {
  // Gradle also applies init scripts to included plugin builds.
  if (rootProject.projectDir.canonicalPath != selection.projectRoot) return
  def worklets = rootProject.findProject(':react-native-worklets')
  def reanimated = rootProject.findProject(':react-native-reanimated')
  if (worklets == null || reanimated == null) throw new GradleException('worklets_staging_projects_required')
  def configuration = selection.configuration
  def nativeConfiguration = configuration == 'Release' ? 'RelWithDebInfo' : 'Debug'
  def externalBuild = worklets.tasks.named('externalNativeBuild' + configuration)
  def digest = { file -> MessageDigest.getInstance('SHA-256').digest(file.bytes).encodeHex().toString() }
  selection.architectures.each { abi ->
    def prefix = 'buildCMake' + nativeConfiguration + '[' + abi + ']'
    def nativeTasks = worklets.tasks.matching { it.name == prefix || it.name == prefix + '[worklets]' }.toList()
    if (nativeTasks.size() != 1) throw new GradleException('exact_worklets_native_task_required')
    def nativeTask = nativeTasks[0]
    def consumers = reanimated.tasks.matching { it.name == prefix || it.name.startsWith(prefix + '[') }.toList()
    if (consumers.empty) throw new GradleException('reanimated_native_consumer_required')
    def legacy = worklets.layout.buildDirectory.dir('intermediates/cmake/' + configuration.toLowerCase() + '/obj/' + abi)
    def compiled = nativeTask.soFolder.file('libworklets.so')
    def validateOutput = {
      def binary = compiled.get().asFile.canonicalFile
      def base = worklets.layout.buildDirectory.dir('intermediates/cxx/' + nativeConfiguration).get().asFile.canonicalFile.toPath()
      def relative = base.relativize(binary.toPath())
      if (!binary.toPath().startsWith(base) || relative.nameCount != 4 || relative.getName(1).toString() != 'obj' || relative.getName(2).toString() != abi || relative.getName(3).toString() != 'libworklets.so')
        throw new GradleException('exact_worklets_native_output_required')
      if (!binary.isFile() || binary.length() == 0) throw new GradleException('compiled_worklets_binary_required')
      def target = new File(legacy.get().asFile, 'libworklets.so').canonicalFile
      def expected = new File(worklets.layout.buildDirectory.get().asFile, 'intermediates/cmake/' + configuration.toLowerCase() + '/obj/' + abi + '/libworklets.so').absoluteFile
      if (target.path != expected.path) throw new GradleException('exact_worklets_legacy_output_required')
      return binary
    }
    def stageName = 'cc68StageLegacy' + configuration + 'Worklets' + abi.replaceAll('[^A-Za-z0-9]', '')
    def stage = worklets.tasks.register(stageName) {
      dependsOn externalBuild, nativeTask
      // A regular task always validates the source, including when it is missing.
      doLast {
        def source = validateOutput()
        def target = new File(legacy.get().asFile, 'libworklets.so')
        def sourceHash = digest(source)
        def sameFile = target.isFile() && Files.isSameFile(source.toPath(), target.toPath())
        // AGP may republish a hard link. Opening that target for writing would
        // truncate the compiled source too. Preserve the existing shared inode.
        if (!sameFile) {
          Files.createDirectories(target.parentFile.toPath())
          def temporary = Files.createTempFile(target.parentFile.toPath(), '.cc68-worklets-', '.so')
          try {
            Files.copy(source.toPath(), temporary, StandardCopyOption.REPLACE_EXISTING)
            if (digest(temporary.toFile()) != sourceHash) throw new GradleException('worklets_staging_hash_mismatch')
            Files.move(temporary, target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
          } finally {
            Files.deleteIfExists(temporary)
          }
        }
        validateOutput()
        def targetHash = digest(target)
        if (digest(source) != sourceHash || sourceHash != targetHash) throw new GradleException('worklets_staging_hash_mismatch')
        def proof = new File(selection.evidenceDirectory, 'worklets-staging-' + configuration + '-' + abi + '.json')
        proof.text = JsonOutput.prettyPrint(JsonOutput.toJson([
          projectRoot: selection.projectRoot,
          workletsProject: worklets.projectDir.canonicalPath,
          configuration: configuration,
          architecture: abi,
          nativeTask: nativeTask.path,
          compiled: source.canonicalPath,
          legacyImported: target.canonicalPath,
          stagingMode: sameFile ? 'same_file_verified' : 'atomic_replacement',
          compiledSize: source.length(),
          compiledSha256: sourceHash,
          legacyImportedSha256: targetHash
        ])) + '\\n'
      }
    }
    consumers.each { it.dependsOn stage }
  }
}
`

export function prepareWorkletsStaging({
  projectRoot,
  configuration,
  architectures,
  evidenceDirectory,
}) {
  const abis = typeof architectures === 'string' ? architectures.split(',') : []
  if (
    !['Debug', 'Release'].includes(configuration) ||
    abis.length === 0 ||
    abis.some((abi) => !['arm64-v8a', 'x86_64'].includes(abi)) ||
    new Set(abis).size !== abis.length
  )
    throw new Error('worklets_build_selection_required')
  const selection = {
    projectRoot: fs.realpathSync(projectRoot),
    configuration,
    architectures: abis,
    evidenceDirectory: fs.realpathSync(evidenceDirectory),
  }
  const file = path.join(
    selection.evidenceDirectory,
    `worklets-staging-${configuration}-${abis.join('_')}.init.gradle`
  )
  fs.writeFileSync(file, initScript(selection), { mode: 0o600 })
  const proofs = abis.map((abi) =>
    path.join(
      selection.evidenceDirectory,
      `worklets-staging-${configuration}-${abi}.json`
    )
  )
  // A failed build must never pass verification using an earlier build's report.
  for (const proof of proofs) fs.rmSync(proof, { force: true })
  return { ...selection, args: ['--init-script', file], proofs }
}

export function verifyWorkletsStaging(plan) {
  return plan.proofs.map((file, index) => {
    const proof = JSON.parse(fs.readFileSync(file, 'utf8'))
    const abi = plan.architectures[index]
    const nativeConfiguration =
      plan.configuration === 'Release' ? 'RelWithDebInfo' : 'Debug'
    const worklets = fs.realpathSync(proof.workletsProject)
    const source = fs.realpathSync(proof.compiled)
    const target = fs.realpathSync(proof.legacyImported)
    const relative = path
      .relative(
        path.join(worklets, 'build/intermediates/cxx', nativeConfiguration),
        source
      )
      .split(path.sep)
    if (
      proof.projectRoot !== plan.projectRoot ||
      proof.configuration !== plan.configuration ||
      proof.architecture !== abi ||
      relative.length !== 4 ||
      relative[0] === '..' ||
      relative[1] !== 'obj' ||
      relative[2] !== abi ||
      relative[3] !== 'libworklets.so' ||
      target !==
        path.join(
          worklets,
          'build/intermediates/cmake',
          plan.configuration.toLowerCase(),
          'obj',
          abi,
          'libworklets.so'
        )
    )
      throw new Error('worklets_staging_proof_selection_mismatch')
    const digest = (binary) =>
      createHash('sha256').update(fs.readFileSync(binary)).digest('hex')
    const sourceHash = digest(source)
    if (
      fs.statSync(source).size === 0 ||
      sourceHash !== proof.compiledSha256 ||
      digest(target) !== sourceHash ||
      proof.legacyImportedSha256 !== sourceHash
    )
      throw new Error('worklets_staging_hash_mismatch')
    return proof
  })
}
