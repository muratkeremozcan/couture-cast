/** Browser/production-neutral surface. Native test fixtures require the isolated app identity. */
export function shareCardPreviewTestId(loaded: boolean, _digest: string) {
  return loaded ? 'share-card-preview-loaded' : 'share-card-preview'
}
export function startShareCardNativeFixture(): () => void {
  return () => undefined
}
export function shareCardFixtureMode(): string {
  return 'real'
}
export function runShareCardNativeAdapter(
  _fileUri: string,
  save: () => Promise<void>
): Promise<void> {
  return save()
}

export function waitShareCardNativePreparation(
  _signal: AbortSignal,
  _purpose?: 'preview' | 'save'
): Promise<void> {
  return Promise.resolve()
}
