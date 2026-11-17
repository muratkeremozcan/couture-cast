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
export declare function maestroFlowTitle(flowPath: string, yamlText: string): string
export declare function decodeXmlText(text: string): string
export declare function addFlowFailureCause(
  flowFailures: string[],
  flowPasses: Set<string>,
  flowPath: string,
  cause: string,
  options?: { reportedAs?: string }
): void
