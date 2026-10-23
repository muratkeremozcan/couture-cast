export declare function lastStartedMaestroCommand(logText: string): string | undefined
export declare function newestFlowDebugLog(
  artifactDir: string,
  flowTitle: string,
  options?: { sinceMs?: number }
): string | undefined
export declare function removeReportEverywhere(
  artifactRoot: string,
  reportPath: string
): string[]
export declare function describeMissingReport(
  flowPath: string,
  unreadable: string,
  maestroExitError: Error | undefined,
  lastCommand: string | undefined
): string
export declare function flowTitleOf(yamlText: string): string | undefined
