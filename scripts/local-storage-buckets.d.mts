/** Type declarations for `local-storage-buckets.mjs`, for its unit tests under `playwright/`. */

export type BucketDefinition = {
  id: string
  name: string
  public: boolean
  file_size_limit: number | null
  allowed_mime_types: string[] | null
}

export declare const MIGRATIONS_DIR: string

export declare function bucketUpsertsFromSql(
  sql: string,
  source?: string
): { definition: BucketDefinition; assigned: string[] }[]

export declare function bucketDefinitionsFromSql(
  sql: string,
  source?: string
): BucketDefinition[]

export declare function bucketDefinitionsFromMigrations(
  migrationsDir?: string
): BucketDefinition[]

export declare function planBuckets(
  required: readonly BucketDefinition[],
  existing: readonly Partial<BucketDefinition>[]
): { create: BucketDefinition[]; update: BucketDefinition[]; unchanged: string[] }

export declare function missingBuckets(
  required: readonly { id: string }[],
  existing: readonly { id?: string }[]
): string[]

export declare function assertBucketsPresent(
  required: readonly { id: string }[],
  existing: readonly { id?: string }[]
): void

export type LocalStorageApi = {
  list(): Promise<Partial<BucketDefinition>[]>
  create(bucket: BucketDefinition): Promise<unknown>
  update(bucket: BucketDefinition): Promise<unknown>
}

export declare function localStorageApi(options: {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
}): LocalStorageApi

export declare function listWhenReady(
  api: Pick<LocalStorageApi, 'list'>,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<Partial<BucketDefinition>[]>
