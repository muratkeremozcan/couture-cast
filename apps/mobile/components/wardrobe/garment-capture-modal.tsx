// Story 4.4 Task 6 step 1 owner: extract the garment-capture flow that used to live
// inline in apps/mobile/app/(tabs)/wardrobe.tsx into a reusable component, mirroring
// Web's existing separation between garment-capture-modal.tsx and wardrobe/page.tsx.
// This lets the new wardrobe-onboarding screen reuse the exact same capture/crop/upload
// state machine instead of duplicating it (project-context.md: avoid duplicate utility
// implementations across apps).
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import * as Crypto from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import {
  createGarmentItemResponseSchema,
  createGarmentUploadUrlResponseSchema,
  uploadGarmentBytes,
  type GarmentItemContract,
} from '@couture/api-client/contracts/http'

import { resolveMobileApiBaseUrl } from '@/src/lib/api-client'
import { resolveMobileAccessToken } from '@/src/lib/mobile-auth'
import { sha256Hex } from '@/src/lib/expo-native-helpers'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'

type CaptureStep = 'source' | 'crop' | 'uploading' | 'complete'
type AspectRatio = '1:1' | '4:3'
type SelectedImage = { uri: string; width: number; height: number }

async function responseError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: string }
    return new Error(body.message ?? `Wardrobe request failed with ${response.status}`)
  } catch {
    return new Error(`Wardrobe request failed with ${response.status}`)
  }
}

function cropForAspect(image: SelectedImage, aspectRatio: AspectRatio) {
  const targetRatio = aspectRatio === '1:1' ? 1 : 3 / 4
  const sourceRatio = image.width / image.height
  const width = sourceRatio > targetRatio ? image.height * targetRatio : image.width
  const height = sourceRatio > targetRatio ? image.height : image.width / targetRatio
  return {
    originX: Math.round((image.width - width) / 2),
    originY: Math.round((image.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export interface MobileGarmentCaptureModalProps {
  visible: boolean
  onClose: () => void
  /**
   * Fires once bytes are committed server-side. The caller owns what happens next
   * (opening the tagging modal, polling a still-processing garment, refreshing a
   * list) because that varies by caller: the wardrobe hub and the onboarding
   * checklist react to a committed garment differently.
   */
  onGarmentCommitted?: (garment: GarmentItemContract, accessToken: string) => void
  /** Focus returns here on close, matching the tagging/capsule modal convention. */
  invokingNodeHandle?: number | null
}

// eslint-disable-next-line complexity
export function MobileGarmentCaptureModal({
  visible,
  onClose,
  onGarmentCommitted,
  invokingNodeHandle,
}: MobileGarmentCaptureModalProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<CaptureStep>('source')
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [useBgCleanup, setUseBgCleanup] = useState(true)
  const [uploadStatus, setUploadStatus] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const titleRef = useRef<React.ElementRef<typeof Text> | null>(null)
  const invokingNodeHandleRef = useRef(invokingNodeHandle)
  invokingNodeHandleRef.current = invokingNodeHandle

  useEffect(() => () => uploadAbortRef.current?.abort(), [])

  useEffect(() => {
    if (!visible) return
    const focusTimer =
      Platform.OS === 'web'
        ? null
        : setTimeout(() => {
            const node = safeFindNodeHandle(titleRef.current)
            if (node) AccessibilityInfo.setAccessibilityFocus(node)
          }, 150)
    return () => {
      if (focusTimer !== null) clearTimeout(focusTimer)
      const invoker = invokingNodeHandleRef.current
      if (Platform.OS !== 'web' && invoker) {
        AccessibilityInfo.setAccessibilityFocus(invoker)
      }
    }
  }, [visible])

  const resetCapture = () => {
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
    setStep('source')
    setSelectedImage(null)
    setUploadStatus('')
    setErrorMessage(null)
  }

  const handleClose = () => {
    resetCapture()
    onClose()
  }

  const selectAsset = (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.width < 256 || asset.height < 256) {
      setErrorMessage(t('wardrobe.error.invalid_image'))
      return
    }
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
      setErrorMessage(t('wardrobe.error.image_too_large'))
      return
    }
    setSelectedImage({ uri: asset.uri, width: asset.width, height: asset.height })
    setErrorMessage(null)
    setStep('crop')
  }

  const openCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) {
      setErrorMessage(
        permission.canAskAgain
          ? t('wardrobe.permission.camera_denied')
          : t('wardrobe.permission.camera_blocked')
      )
      return
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
    })
    if (!result.canceled && result.assets[0]) {
      selectAsset(result.assets[0])
    }
  }

  const openLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setErrorMessage(t('wardrobe.permission.library_denied'))
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    })
    if (!result.canceled && result.assets[0]) {
      selectAsset(result.assets[0])
    }
  }

  const selectFixture = async () => {
    // Required lazily (not at module scope) so importing this component in a Vite/
    // vitest environment, which has no Metro `require` for static assets, doesn't
    // throw; only pressing the __DEV__-only fixture button below ever runs it.
    const fixtureImage = require('../../assets/images/icon.png') as number
    const source = Image.resolveAssetSource(fixtureImage)
    try {
      const fixtureFile = await File.downloadFileAsync(
        source.uri,
        new File(Paths.cache, 'garment-capture-fixture.png'),
        { idempotent: true }
      )
      setSelectedImage({
        uri: fixtureFile.uri,
        width: source.width,
        height: source.height,
      })
      setErrorMessage(null)
      setStep('crop')
    } catch {
      setErrorMessage(t('wardrobe.error.invalid_image'))
    }
  }

  const uploadSelectedImage = async () => {
    if (!selectedImage) return
    const controller = new AbortController()
    uploadAbortRef.current = controller
    setStep('uploading')
    setErrorMessage(null)

    try {
      setUploadStatus(t('wardrobe.upload.preparing'))
      const crop = cropForAspect(selectedImage, aspectRatio)
      const maxDimension = Math.max(crop.width, crop.height)
      const resizeScale = Math.min(1, 2048 / maxDimension)
      const prepared = await manipulateAsync(
        selectedImage.uri,
        [
          { crop },
          {
            resize: {
              width: Math.round(crop.width * resizeScale),
              height: Math.round(crop.height * resizeScale),
            },
          },
        ],
        { compress: 0.92, format: SaveFormat.PNG }
      )
      const file = new File(prepared.uri)
      const bytes = await file.bytes()
      if (bytes.byteLength > 10 * 1024 * 1024) {
        throw new Error(t('wardrobe.error.image_too_large'))
      }
      const accessToken = await resolveMobileAccessToken()
      if (!accessToken) {
        throw new Error('AUTHENTICATION_REQUIRED')
      }

      setUploadStatus(t('wardrobe.upload.requesting'))
      const allocationResponse = await fetch(
        `${resolveMobileApiBaseUrl()}/api/v1/wardrobe/upload-url`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': Crypto.randomUUID(),
          },
          body: JSON.stringify({
            fileSizeBytes: bytes.byteLength,
            mimeType: 'image/png',
            sha256: await sha256Hex(bytes),
            widthPx: prepared.width,
            heightPx: prepared.height,
          }),
          signal: controller.signal,
        }
      )
      if (!allocationResponse.ok) {
        throw await responseError(allocationResponse)
      }
      const allocation = createGarmentUploadUrlResponseSchema.parse(
        await allocationResponse.json()
      ).data

      setUploadStatus(t('wardrobe.upload.uploading'))
      await uploadGarmentBytes({
        uploadUrl: allocation.uploadUrl,
        uploadToken: allocation.uploadToken,
        bearerToken: accessToken,
        mimeType: 'image/png',
        body: bytes.buffer,
        signal: controller.signal,
      })

      setUploadStatus(t('wardrobe.upload.verifying'))
      const commitResponse = await fetch(
        `${resolveMobileApiBaseUrl()}/api/v1/wardrobe/garments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': Crypto.randomUUID(),
          },
          body: JSON.stringify({
            garmentId: allocation.garmentId,
            uploadSessionId: allocation.uploadSessionId,
            hasCropping: true,
            hasBgCleanup: useBgCleanup,
          }),
          signal: controller.signal,
        }
      )
      if (!commitResponse.ok) {
        throw await responseError(commitResponse)
      }
      const garment = createGarmentItemResponseSchema.parse(
        await commitResponse.json()
      ).data
      onGarmentCommitted?.(garment, accessToken)
      setUploadStatus(t('wardrobe.upload.processing'))
      setStep('complete')
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorMessage(
          error instanceof Error ? error.message : t('wardrobe.upload.failed')
        )
        setStep('crop')
      }
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null
      }
    }
  }

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={handleClose}>
      <View
        style={styles.modal}
        testID="garment-capture-modal"
        accessibilityViewIsModal={true}
        onAccessibilityEscape={handleClose}
      >
        <View style={styles.modalHeader}>
          <Text
            ref={titleRef}
            style={styles.modalTitle}
            accessible={true}
            accessibilityRole="header"
          >
            {t('wardrobe.capture.title')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
            testID="garment-capture-close"
            onPress={handleClose}
          >
            <Text style={styles.closeButton}>✕</Text>
          </Pressable>
        </View>

        {errorMessage ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <Text>{errorMessage}</Text>
            {errorMessage === t('wardrobe.permission.camera_blocked') ? (
              <Pressable onPress={() => void Linking.openSettings()}>
                <Text style={styles.link}>{t('wardrobe.permission.open_settings')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {step === 'source' ? (
          <View style={styles.sourceActions}>
            <Pressable
              accessibilityRole="button"
              testID="garment-source-camera"
              style={styles.sourceButton}
              onPress={() => void openCamera()}
            >
              <Text style={styles.sourceButtonText}>{t('wardrobe.capture.camera')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="garment-source-library"
              style={styles.sourceButton}
              onPress={() => void openLibrary()}
            >
              <Text style={styles.sourceButtonText}>{t('wardrobe.capture.library')}</Text>
            </Pressable>
            {__DEV__ ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use deterministic garment fixture"
                testID="garment-e2e-fixture-source"
                style={styles.fixtureButton}
                onPress={() => void selectFixture()}
              >
                <Text>Use deterministic garment fixture</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {step === 'crop' && selectedImage ? (
          <ScrollView contentContainerStyle={styles.cropContent}>
            <Text style={styles.sectionTitle}>{t('wardrobe.crop.title')}</Text>
            <Image
              source={{ uri: selectedImage.uri }}
              resizeMode="cover"
              testID="garment-crop-preview"
              style={
                aspectRatio === '1:1' ? styles.squarePreview : styles.portraitPreview
              }
            />
            <View style={styles.row}>
              <Pressable
                testID="garment-aspect-square"
                style={styles.optionButton}
                onPress={() => setAspectRatio('1:1')}
              >
                <Text>{t('wardrobe.crop.aspect_square')}</Text>
              </Pressable>
              <Pressable
                testID="garment-aspect-portrait"
                style={styles.optionButton}
                onPress={() => setAspectRatio('4:3')}
              >
                <Text>{t('wardrobe.crop.aspect_four_three')}</Text>
              </Pressable>
            </View>
            <View style={styles.cleanupRow}>
              <Text>{t('wardrobe.cleanup.title')}</Text>
              <Switch
                accessibilityLabel={t('wardrobe.cleanup.title')}
                testID="garment-cleanup-toggle"
                value={useBgCleanup}
                onValueChange={setUseBgCleanup}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              testID="garment-confirm-image"
              style={styles.primaryButton}
              onPress={() => void uploadSelectedImage()}
            >
              <Text style={styles.primaryButtonText}>
                {t('wardrobe.confirm.use_image')}
              </Text>
            </Pressable>
          </ScrollView>
        ) : null}

        {step === 'uploading' ? (
          <View style={styles.uploadState} testID="garment-upload-progress">
            <ActivityIndicator />
            <Text>{uploadStatus}</Text>
            <Pressable
              testID="garment-upload-cancel"
              onPress={() => {
                uploadAbortRef.current?.abort()
                setStep('crop')
              }}
            >
              <Text style={styles.link}>{t('wardrobe.upload.cancel')}</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'complete' ? (
          <View style={styles.completeState} testID="garment-capture-complete">
            <Text style={styles.completeIcon}>✓</Text>
            <Text style={styles.sectionTitle}>{t('wardrobe.upload.processing')}</Text>
            <Pressable
              testID="garment-capture-done"
              style={styles.primaryButton}
              onPress={handleClose}
            >
              <Text style={styles.primaryButtonText}>
                {t('common.done', { defaultValue: 'Done' })}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modal: { flex: 1, padding: 20, paddingTop: 64 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  modalTitle: { fontSize: 24, fontWeight: '700' },
  closeButton: { fontSize: 24, padding: 8 },
  errorBox: { borderRadius: 12, backgroundColor: '#FEE2E2', padding: 12, gap: 8 },
  link: { color: '#8A5A00', fontWeight: '700', paddingVertical: 8 },
  sourceActions: { gap: 16 },
  sourceButton: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#D4D4D8',
    borderStyle: 'dashed',
    borderRadius: 16,
  },
  sourceButtonText: { fontSize: 18, fontWeight: '700' },
  fixtureButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cropContent: { gap: 18, alignItems: 'stretch' },
  sectionTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  squarePreview: { width: '100%', aspectRatio: 1, borderRadius: 16 },
  portraitPreview: { width: '100%', aspectRatio: 0.75, borderRadius: 16 },
  row: { flexDirection: 'row', gap: 10 },
  optionButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#E4E4E7',
  },
  cleanupRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#111111',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  uploadState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  completeState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  completeIcon: { fontSize: 56, color: '#059669' },
})
