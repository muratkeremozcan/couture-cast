import fs from 'node:fs'
import path from 'node:path'
const directory = path.resolve(
  process.env.CC68_HARNESS_DIR ?? '_bmad-output/test-artifacts/story-6-8/runtime'
)
const output = path.join(directory, 'public-evidence')
fs.mkdirSync(output, { recursive: true })
const closedJSON = (name, value) => {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|access_token|refresh_token|service_role|@example\.test|@cc68\.test/i.test(
      text
    )
  )
    throw new Error('private_data_in_public_evidence')
  fs.writeFileSync(path.join(output, name), text)
}
for (const name of fs.readdirSync(directory)) {
  if (
    /^(saved-original-(android|ios)(-[a-z-]+)?|native-(android|ios)-[A-Za-z0-9-]+)\.png$/.test(
      name
    )
  )
    fs.copyFileSync(path.join(directory, name), path.join(output, name))
  if (/^original-proof-(android|ios)(-[a-z-]+)?\.json$/.test(name)) {
    const proof = JSON.parse(fs.readFileSync(path.join(directory, name)))
    closedJSON(name, {
      sha256: proof.sha256,
      bytes: proof.bytes,
      chunks: proof.chunks,
      exactOneNewAsset: proof.exactOneNewAsset,
      featureCacheEmpty: proof.featureCacheEmpty,
    })
  }
  if (
    /^(native-matrix-(android|ios)|accessibility-(android|ios|bridge)|expo-go-unavailable|permission-ios)\.json$/.test(
      name
    )
  )
    closedJSON(name, JSON.parse(fs.readFileSync(path.join(directory, name))))
}
console.log('Closed share-card evidence selected and secret-scanned.')
