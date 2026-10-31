/** Raw values the native bridge may return. JS validates every result before use. */
export type ShareCardNativeShareTarget =
  | 'pinterest'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'other'
  | 'none'
  | 'unknown'
export type ShareCardNativeShareOutcome =
  | 'completed'
  | 'target_chosen'
  | 'cancelled'
  | 'not_confirmed'
  | 'failed'
  | 'unavailable'
export type ShareCardNativeShareCode =
  | 'presenter_unavailable'
  | 'file_invalid'
  | 'chooser_unavailable'
  | 'start_failed'
  | 'native_error'
  | 'busy'
export type ShareCardNativeShareResult = {
  target: ShareCardNativeShareTarget
  outcome: ShareCardNativeShareOutcome
  code?: ShareCardNativeShareCode
}
/** Share button frame in window coordinates, used as the iPad popover sourceRect. */
export type ShareCardShareAnchor = { x: number; y: number; width: number; height: number }
export interface ShareCardNativeShareModule {
  /**
   * Hands one validated `cache/share-cards/cc69-share-<uuid>.png` file to the OS share sheet and
   * resolves once with `{target, outcome, code?}` at settlement. Never rejects for user outcomes.
   */
  shareFile(
    fileUri: string,
    expectedSha256: string,
    anchor: ShareCardShareAnchor | null
  ): Promise<unknown>
}
