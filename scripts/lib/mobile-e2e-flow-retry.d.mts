export declare function runMobileE2EFlow(options: {
  run: () => Promise<void>
  reset: () => Promise<void>
  onRetry: (error: Error) => void
}): Promise<void>
