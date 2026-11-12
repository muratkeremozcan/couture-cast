export declare function localSupabasePorts(env?: NodeJS.ProcessEnv): {
  api: number
  db: number
  inbucket: number
}
export declare function localDatabaseUrl(env?: NodeJS.ProcessEnv): string
export declare function localSupabaseApiUrl(env?: NodeJS.ProcessEnv): string
export declare function localMailpitUrl(env?: NodeJS.ProcessEnv): string
export declare function isLocalSupabaseDatabaseUrl(
  value: string | undefined,
  env?: NodeJS.ProcessEnv
): boolean
