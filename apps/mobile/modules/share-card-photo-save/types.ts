export interface ShareCardPhotoSaveModule {
  saveOriginalPng(fileUri: string, expectedSha256: string): Promise<void>
}
