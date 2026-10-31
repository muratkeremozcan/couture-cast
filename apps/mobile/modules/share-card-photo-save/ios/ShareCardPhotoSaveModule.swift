// Story 6.8 Task 6 step 1 owner: import the original PNG into Photos in `apps/mobile/modules/share-card-photo-save/ios/ShareCardPhotoSaveModule.swift`
import ExpoModulesCore
import Photos

public final class ShareCardPhotoSaveModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShareCardPhotoSave")
    AsyncFunction("saveOriginalPng") { (fileUri: String, expectedSha256: String, promise: Promise) in
      guard PHPhotoLibrary.authorizationStatus(for: .addOnly) == .authorized || PHPhotoLibrary.authorizationStatus(for: .addOnly) == .limited else {
        promise.reject("permission_denied", "permission_denied"); return
      }
      do {
        let url = try ShareCardPngFile.validateFile(fileUri, expectedSha256, self.appContext?.config.cacheDirectory)
        // Photos retains its transaction and this completion closure until native settlement.
        PHPhotoLibrary.shared().performChanges({
          let request = PHAssetCreationRequest.forAsset()
          let options = PHAssetResourceCreationOptions()
          options.shouldMoveFile = false
          options.uniformTypeIdentifier = "public.png"
          options.originalFilename = "couturecast-card.png"
          request.addResource(with: .photo, fileURL: url, options: options)
        }, completionHandler: { success, _ in
          if success { promise.resolve() }
          else { promise.reject("save_failed", "save_failed") }
        })
      } catch { promise.reject("invalid_file", "invalid_file") }
    }
  }

}
