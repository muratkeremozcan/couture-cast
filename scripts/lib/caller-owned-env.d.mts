export declare function callerOwnedEnv(env?: NodeJS.ProcessEnv): Record<string, string>
export declare function loadEnvKeepingCallerOwned(
  loadEnvFiles: () => void,
  env?: NodeJS.ProcessEnv
): void
export declare function isLoopbackUrl(value: string | undefined): boolean
export declare function inheritedLocalStackEnv(
  env?: NodeJS.ProcessEnv
): Record<string, string>
export declare function loadEnvKeepingLocalStack(
  loadEnvFiles: () => void,
  env?: NodeJS.ProcessEnv
): void
export declare function loadLauncherEnv(
  env: NodeJS.ProcessEnv,
  loadEnvFiles: () => void
): void
