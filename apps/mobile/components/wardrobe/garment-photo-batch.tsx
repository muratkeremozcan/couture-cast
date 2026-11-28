import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ElementRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { useTranslation } from 'react-i18next'
import * as ImagePicker from 'expo-image-picker'
import {
  AccessibilityInfo,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  View,
} from 'react-native'
import type {
  GarmentItemContract,
  UploadAttemptSession,
} from '@couture/api-client/contracts/http'
import {
  GARMENT_PHOTO_BATCH_LIMIT,
  GarmentPhotoBatch,
  garmentPhotoBatchStrings,
  type GarmentPhotoBatchState,
} from '@couture/utils'
import { Text, createSchemeStyles } from '@/components/themed'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import {
  prepareGarmentCaptureImage,
  releaseGarmentCaptureFile,
  releaseImagePickerCopy,
  type PreparedGarmentImage,
} from '@/src/lib/garment-capture-image'
import {
  garmentImageFingerprint,
  uploadGarmentImageFromMobile,
} from '@/src/lib/garment-upload'
import { currentUploadSession, isUploadSessionCurrent } from '@/src/lib/upload-attempts'

async function preparePhoto(asset: ImagePicker.ImagePickerAsset, signal: AbortSignal) {
  if (
    asset.width < 256 ||
    asset.height < 256 ||
    (asset.fileSize ?? 0) > 10 * 1024 * 1024
  ) {
    throw new Error('Invalid photo')
  }
  const image = await prepareGarmentCaptureImage(asset, '1:1', true, signal)
  if (!image) throw new Error('Photo preparation cancelled')
  try {
    return {
      image,
      preview: image.file.uri,
      fingerprint: await garmentImageFingerprint(image),
    }
  } catch (error) {
    releaseGarmentCaptureFile(image.file)
    throw error
  }
}

type Props = {
  children: ReactNode
  resetRef: RefObject<(() => void) | null>
  onClose: () => void
  onGarmentCommitted: (garment: GarmentItemContract, token: string) => void
}

export function MobileGarmentPhotoBatch({
  children,
  resetRef,
  onClose,
  onGarmentCommitted,
}: Props) {
  const { t, i18n } = useTranslation()
  const strings = garmentPhotoBatchStrings(i18n.language)
  const themed = useThemedStyles()
  const committed = useRef(onGarmentCommitted)
  committed.current = onGarmentCommitted
  const [state, setState] = useState<GarmentPhotoBatchState>()
  const [batch] = useState(
    () =>
      new GarmentPhotoBatch<
        ImagePicker.ImagePickerAsset,
        PreparedGarmentImage,
        UploadAttemptSession,
        { garment: GarmentItemContract; accessToken: string }
      >(
        {
          isCurrent: isUploadSessionCurrent,
          prepare: preparePhoto,
          releaseSource: ({ uri }) => releaseImagePickerCopy(uri),
          releasePrepared: ({ image }) => releaseGarmentCaptureFile(image.file),
          upload: (prepared, uploadSession, attemptId, signal) =>
            uploadGarmentImageFromMobile({ prepared, uploadSession, attemptId, signal }),
          onCommitted: ({ garment, accessToken }) =>
            committed.current(garment, accessToken),
        },
        setState
      )
  )
  useLayoutEffect(() => {
    resetRef.current = () => batch.reset()
    return () => {
      resetRef.current = null
      batch.reset(false)
    }
  }, [batch, resetRef])
  const title = useRef<ElementRef<typeof NativeText>>(null)
  const { phase, rows, keptCount, busy, pickerError } = state ?? batch.state
  useEffect(() => {
    if (phase === 'source' || Platform.OS === 'web') return
    const node = safeFindNodeHandle(title.current)
    if (node) AccessibilityInfo.setAccessibilityFocus(node)
  }, [phase])

  const openPicker = async (id?: number) => {
    const pick =
      id === undefined ? batch.open(currentUploadSession()) : batch.openRetry(id)
    if (!pick) return
    try {
      // The system picker grants access only to the chosen photos.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: id === undefined,
        selectionLimit: id === undefined ? GARMENT_PHOTO_BATCH_LIMIT : 1,
      })
      if (result.canceled) batch.cancelPicker(pick)
      else await batch.accept(pick, result.assets)
    } catch {
      batch.cancelPicker(pick, 'pickerFailed')
    }
  }

  if (phase === 'source') {
    return (
      <View style={styles.source}>
        {children}
        <Pressable
          accessibilityRole="button"
          testID="garment-batch-picker"
          style={[styles.sourceButton, themed.outline]}
          onPress={() => void openPicker()}
        >
          <Text style={styles.sourceLabel}>{strings.choose}</Text>
        </Pressable>
        {pickerError && (
          <Text accessibilityRole="alert" style={themed.danger}>
            {strings[pickerError]}
          </Text>
        )}
      </View>
    )
  }

  return (
    <View style={styles.review}>
      <NativeText
        ref={title}
        accessible
        accessibilityRole="header"
        style={[styles.title, themed.ink]}
      >
        {phase === 'review' ? strings.review : strings.results}
      </NativeText>
      <ScrollView contentContainerStyle={styles.rows}>
        {rows.map((row) => (
          <View
            key={row.id}
            testID={`garment-batch-row-${row.id}`}
            style={[styles.row, themed.outline]}
          >
            {row.preview && (
              <Image
                source={{ uri: row.preview }}
                resizeMode="contain"
                accessible
                accessibilityLabel={strings.photo(row.id)}
                testID={`garment-batch-preview-${row.id}`}
                style={[styles.preview, themed.card]}
              />
            )}
            <View style={styles.rowCopy}>
              <Text style={styles.label}>{strings.photo(row.id)}</Text>
              {row.status === 'ready' ? (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: row.keep }}
                  accessibilityLabel={strings.keep}
                  accessibilityHint={strings.photo(row.id)}
                  testID={`garment-batch-keep-${row.id}`}
                  style={styles.keep}
                  onPress={() => batch.toggleKeep(row.id)}
                >
                  <View
                    style={[styles.checkbox, themed.outline, row.keep && themed.inverse]}
                  >
                    {row.keep && <Text style={themed.onInverse}>✓</Text>}
                  </View>
                  <Text>{strings.keep}</Text>
                </Pressable>
              ) : (
                <Text accessibilityLiveRegion="polite" style={themed.soft}>
                  {row.differentPhoto ? strings.differentPhoto : strings[row.status]}
                </Text>
              )}
            </View>
            {row.status === 'failed' && (
              <Pressable
                accessibilityRole="button"
                accessibilityHint={strings.photo(row.id)}
                accessibilityState={{ disabled: busy }}
                testID={`garment-batch-retry-${row.id}`}
                style={[styles.retry, themed.outline, busy && styles.disabled]}
                disabled={busy}
                onPress={() => void openPicker(row.id)}
              >
                <Text style={styles.label}>{strings.retry}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
      {pickerError && (
        <Text accessibilityRole="alert" style={themed.danger}>
          {strings[pickerError]}
        </Text>
      )}
      {phase === 'review' ? (
        <BatchAction
          label={strings.add(keptCount)}
          testID="garment-batch-add"
          disabled={busy || keptCount === 0}
          onPress={() => void batch.save()}
        />
      ) : (
        <BatchAction
          label={t('common.done', { defaultValue: 'Done' })}
          testID="garment-batch-done"
          disabled={busy}
          onPress={onClose}
        />
      )}
    </View>
  )
}

function BatchAction({
  label,
  testID,
  disabled,
  onPress,
}: {
  label: string
  testID: string
  disabled: boolean
  onPress: () => void
}) {
  const themed = useThemedStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={[styles.action, themed.inverse, disabled && styles.disabled]}
    >
      <Text style={[styles.label, themed.onInverse]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  source: { gap: 16 },
  sourceButton: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
  },
  sourceLabel: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  review: { flex: 1, gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  rows: { gap: 8 },
  row: {
    minHeight: 64,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  preview: { width: 84, height: 84, borderRadius: 8 },
  rowCopy: { flex: 1, gap: 2 },
  label: { fontWeight: '700' },
  keep: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center' },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  action: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  disabled: { opacity: 0.6 },
})

const useThemedStyles = createSchemeStyles((colors) => ({
  outline: { borderColor: colors.lineStrong },
  card: { backgroundColor: colors.cardMuted },
  ink: { color: colors.ink },
  soft: { color: colors.inkSoft },
  inverse: { backgroundColor: colors.inverse },
  onInverse: { color: colors.onInverse },
  danger: { color: colors.dangerInk },
}))
