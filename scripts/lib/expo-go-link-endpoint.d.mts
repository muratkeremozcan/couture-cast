export declare const EXPO_GO_PACKAGE: string
export declare const DISABLE_ONBOARDING_EXTRA: string

export type CommandResult = { code: number | null; output: string }
export type CommandRunner = (binary: string, args: string[]) => Promise<CommandResult>

export declare function expoGoOpenLinkArgs(
  device: string,
  url: string,
  options?: { disableOnboarding?: boolean }
): string[]

export declare function startExpoGoLinkEndpoint(options: {
  adbBinary: string
  devices: string[]
  disableOnboarding?: boolean
  run?: CommandRunner
}): Promise<{ url: string; close: () => Promise<void> }>

export declare function listAdbDevices(
  adbBinary: string,
  run?: CommandRunner
): Promise<string[]>
