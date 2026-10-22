// Story 6.5 owner: Supabase session persistence inside SecureStore's per-value limit.
//
// Expo SecureStore warns above 2048 bytes and the iOS Keychain can refuse larger values,
// which would silently drop the persisted session and break restore after a cold start.
// A Supabase session (two JWTs plus the user and its metadata) routinely exceeds that.
//
// Values within the budget are stored as they are. Larger values are split into chunks
// under generation-tagged keys, and a small manifest under the original key is written
// last as the commit point: an interrupted write leaves the previous generation intact,
// and a read that finds any chunk missing reports no session rather than a corrupt one.
import type * as SecureStore from 'expo-secure-store'

type Store = Pick<
  typeof SecureStore,
  | 'getItemAsync'
  | 'setItemAsync'
  | 'deleteItemAsync'
  | 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'
>

/** Bytes per stored value, under SecureStore's 2048-byte guidance with room to spare. */
export const SECURE_VALUE_BUDGET = 1800
const MANIFEST = /^chunked:v1:([a-z0-9]+):(\d+)$/

function utf8Length(codePoint: number) {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
}

/** Splits on code points so no chunk ends inside a character or exceeds the budget. */
export function splitForSecureStore(value: string, budget = SECURE_VALUE_BUDGET) {
  const chunks: string[] = []
  let current = ''
  let bytes = 0
  for (const character of value) {
    const size = utf8Length(character.codePointAt(0)!)
    if (bytes + size > budget) {
      chunks.push(current)
      current = ''
      bytes = 0
    }
    current += character
    bytes += size
  }
  if (current || !chunks.length) chunks.push(current)
  return chunks
}

const chunkKey = (name: string, generation: string, index: number) =>
  `${name}.${generation}.${index}`

function parseManifest(value: string | null) {
  const match = value ? MANIFEST.exec(value) : null
  return match ? { generation: match[1]!, count: Number(match[2]) } : undefined
}

export function secureSessionStorage(
  secure: Store,
  newGeneration: () => string = () =>
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
) {
  const options = { keychainAccessible: secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
  const deleteChunks = (name: string, generation: string, from: number, to: number) =>
    Promise.all(
      Array.from({ length: Math.max(0, to - from) }, (_, offset) =>
        secure.deleteItemAsync(chunkKey(name, generation, from + offset))
      )
    )
  return {
    async getItem(name: string): Promise<string | null> {
      const head = await secure.getItemAsync(name)
      const manifest = parseManifest(head)
      if (!manifest) return head
      const chunks = await Promise.all(
        Array.from({ length: manifest.count }, (_, index) =>
          secure.getItemAsync(chunkKey(name, manifest.generation, index))
        )
      )
      return chunks.every((chunk) => chunk !== null) ? chunks.join('') : null
    },
    async setItem(name: string, value: string): Promise<void> {
      const previous = parseManifest(await secure.getItemAsync(name))
      const chunks = splitForSecureStore(value)
      if (chunks.length === 1) {
        await secure.setItemAsync(name, value, options)
      } else {
        const generation = newGeneration()
        for (const [index, chunk] of chunks.entries())
          await secure.setItemAsync(chunkKey(name, generation, index), chunk, options)
        await secure.setItemAsync(
          name,
          `chunked:v1:${generation}:${chunks.length}`,
          options
        )
      }
      if (previous) await deleteChunks(name, previous.generation, 0, previous.count)
    },
    async removeItem(name: string): Promise<void> {
      const previous = parseManifest(await secure.getItemAsync(name))
      await secure.deleteItemAsync(name)
      if (previous) await deleteChunks(name, previous.generation, 0, previous.count)
    },
  }
}
