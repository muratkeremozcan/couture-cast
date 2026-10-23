export declare function callerOwnedEnv(env?: NodeJS.ProcessEnv): Record<string, string>
export declare function loadEnvKeepingCallerOwned(
  loadEnvFiles: () => void,
  env?: NodeJS.ProcessEnv
): void
