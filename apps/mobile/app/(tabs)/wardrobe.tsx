import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as Crypto from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  findNodeHandle,
} from 'react-native'
import {
  createGarmentItemResponseSchema,
  createGarmentUploadUrlResponseSchema,
  uploadGarmentBytes,
  type GarmentItemContract,
} from '@couture/api-client/contracts/http'

import { Text, View } from '@/components/themed'
import { resolveMobileApiBaseUrl } from '@/src/lib/api-client'
import { resolveMobileAccessToken } from '@/src/lib/mobile-auth'

import { MobileGarmentTaggingModal } from '@/components/wardrobe/garment-tagging-modal'
import { listGarmentsFromMobile } from '@/src/lib/wardrobe'

type CaptureStep = 'source' | 'crop' | 'uploading' | 'complete'
type AspectRatio = '1:1' | '4:3'
type SelectedImage = { uri: string; width: number; height: number }

const fixtureImage = require('../../assets/images/icon.png') as number

async function responseError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: string }
    return new Error(body.message ?? `Wardrobe request failed with ${response.status}`)
  } catch {
    return new Error(`Wardrobe request failed with ${response.status}`)
  }
}

function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    )
  )
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

export default function WardrobeScreen() {
  const { t } = useTranslation()
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCaptureOpen, setIsCaptureOpen] = useState(false)
  const [step, setStep] = useState<CaptureStep>('source')
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string>('')
  const [taggingInvokerNodeHandle, setTaggingInvokerNodeHandle] = useState<number | null>(
    null
  )
  const [useBgCleanup, setUseBgCleanup] = useState(true)
  const [uploadStatus, setUploadStatus] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const pollingAbortRef = useRef<AbortController | null>(null)
  const pendingTaggingGarmentIdRef = useRef<string | null>(null)
  const isCaptureOpenRef = useRef(false)

  useEffect(() => {
    isCaptureOpenRef.current = isCaptureOpen
  }, [isCaptureOpen])

  const loadGarments = useCallback(async (signal?: AbortSignal) => {
    const token = await resolveMobileAccessToken()
    if (!token) {
      throw new Error('AUTHENTICATION_REQUIRED')
    }
    setAccessToken(token)
    setGarments(await listGarmentsFromMobile(token, signal))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadGarments(controller.signal)
      .catch(() => undefined)
      .finally(() => setIsLoading(false))
    return () => {
      controller.abort()
      uploadAbortRef.current?.abort()
      pollingAbortRef.current?.abort()
    }
  }, [loadGarments])

  const resetCapture = () => {
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
    setStep('source')
    setSelectedImage(null)
    setUploadStatus('')
    setErrorMessage(null)
  }

  const closeCapture = () => {
    resetCapture()
    setIsCaptureOpen(false)
    const pendingGarmentId = pendingTaggingGarmentIdRef.current
    pendingTaggingGarmentIdRef.current = null
    if (pendingGarmentId) {
      setTimeout(() => setTaggingGarmentId(pendingGarmentId), 0)
    }
  }

  const waitForPoll = (delayMs: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new Error('POLL_ABORTED'))
        },
        { once: true }
      )
    })

  const pollCommittedGarment = (garmentId: string, token: string) => {
    pollingAbortRef.current?.abort()
    const controller = new AbortController()
    pollingAbortRef.current = controller
    void (async () => {
      try {
        for (const delayMs of [1_000, 2_000, 4_000, 8_000]) {
          await waitForPoll(delayMs, controller.signal)
          const persisted = await listGarmentsFromMobile(token, controller.signal)
          setGarments(persisted)
          const current = persisted.find((garment) => garment.id === garmentId)
          if (!current || current.status === 'processing') continue
          if (current.status === 'awaiting_tags') {
            if (isCaptureOpenRef.current) {
              pendingTaggingGarmentIdRef.current = current.id
            } else {
              setTaggingGarmentId(current.id)
            }
          }
          return
        }
        setErrorMessage(t('wardrobe.tagging.poll_timeout'))
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(
            error instanceof Error ? error.message : t('wardrobe.tagging.load_failed')
          )
        }
      }
    })()
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
      setGarments((current) => [
        garment,
        ...current.filter((item) => item.id !== garment.id),
      ])
      if (garment.status === 'awaiting_tags') {
        pendingTaggingGarmentIdRef.current = garment.id
      } else if (garment.status === 'processing') {
        pollCommittedGarment(garment.id, accessToken)
      }
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
    <>
      <View
        style={styles.screen}
        testID="wardrobe-screen"
        importantForAccessibility={taggingGarmentId ? 'no-hide-descendants' : 'auto'}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t('wardrobe.title')}</Text>
              <Text style={styles.subtitle}>{t('wardrobe.empty_desc')}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              testID="garment-capture-open"
              style={styles.primaryButton}
              onPress={() => setIsCaptureOpen(true)}
            >
              <Text style={styles.primaryButtonText}>{t('wardrobe.add_garment')}</Text>
            </Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator accessibilityLabel="Loading wardrobe" />
          ) : garments.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('wardrobe.empty_title')}</Text>
            </View>
          ) : (
            <View style={styles.grid} testID="wardrobe-garment-list">
              {garments.map((garment) => (
                <View key={garment.id} style={styles.garmentCard}>
                  {garment.imageAccess ? (
                    <Image
                      source={{ uri: garment.imageAccess.url }}
                      accessibilityLabel={t('wardrobe.capture.title')}
                      style={styles.garmentImage}
                    />
                  ) : null}
                  <Text numberOfLines={1} style={styles.garmentId}>
                    {garment.id}
                  </Text>
                  <Text>{garment.status}</Text>
                  {garment.status === 'awaiting_tags' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('wardrobe.tagging.needs_tags', {
                        defaultValue: 'Needs tags',
                      })}
                      style={styles.needsTagsBtn}
                      onPress={(event) => {
                        setTaggingInvokerNodeHandle(
                          findNodeHandle(event.currentTarget as never)
                        )
                        setTaggingGarmentId(garment.id)
                      }}
                    >
                      <Text style={styles.needsTagsText}>
                        {t('wardrobe.tagging.needs_tags', { defaultValue: 'Needs tags' })}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <Modal
          animationType="slide"
          visible={isCaptureOpen}
          onRequestClose={closeCapture}
        >
          <View style={styles.modal} testID="garment-capture-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('wardrobe.capture.title')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
                testID="garment-capture-close"
                onPress={closeCapture}
              >
                <Text style={styles.closeButton}>✕</Text>
              </Pressable>
            </View>

            {errorMessage ? (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <Text>{errorMessage}</Text>
                {errorMessage === t('wardrobe.permission.camera_blocked') ? (
                  <Pressable onPress={() => void Linking.openSettings()}>
                    <Text style={styles.link}>
                      {t('wardrobe.permission.open_settings')}
                    </Text>
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
                  <Text style={styles.sourceButtonText}>
                    {t('wardrobe.capture.camera')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  testID="garment-source-library"
                  style={styles.sourceButton}
                  onPress={() => void openLibrary()}
                >
                  <Text style={styles.sourceButtonText}>
                    {t('wardrobe.capture.library')}
                  </Text>
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
                  onPress={closeCapture}
                >
                  <Text style={styles.primaryButtonText}>
                    {t('common.done', { defaultValue: 'Done' })}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </Modal>
      </View>

      <MobileGarmentTaggingModal
        visible={Boolean(taggingGarmentId)}
        onClose={() => setTaggingGarmentId(null)}
        garmentId={taggingGarmentId}
        accessToken={accessToken}
        invokingNodeHandle={taggingInvokerNodeHandle}
        onTagsConfirmed={(updatedGarment) => {
          setGarments((current) =>
            current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
          )
          setTaggingGarmentId(null)
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  needsTagsBtn: {
    minHeight: 44,
    minWidth: 44,
    backgroundColor: '#FEF9EF',
    borderColor: '#C5A059',
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  needsTagsText: {
    color: '#8A5A00',
    fontWeight: '700',
    fontSize: 12,
  },
  content: { padding: 20, gap: 24 },
  header: { gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { marginTop: 6, opacity: 0.7 },
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
  emptyState: { alignItems: 'center', borderRadius: 16, padding: 36 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  garmentCard: { width: '47%', overflow: 'hidden', borderRadius: 12, padding: 10 },
  garmentImage: { width: '100%', aspectRatio: 0.75, borderRadius: 8 },
  garmentId: { marginTop: 8, fontSize: 12 },
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
  uploadState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  completeState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  completeIcon: { fontSize: 56, color: '#059669' },
})
