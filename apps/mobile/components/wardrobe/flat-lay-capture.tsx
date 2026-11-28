import { useEffect, useRef, useState, type ElementRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  View,
} from 'react-native'
import type { FlatLayCapture, FlatLayCaptureState } from '@couture/api-client'
import {
  FLAT_LAY_MAX_PHOTO_BYTES,
  garmentCategoryEnum,
  garmentComfortRangeEnum,
  garmentMaterialEnum,
  type FlatLayTags,
} from '@couture/api-client/contracts/http'
import {
  flatLayStrings,
  garmentSubtypesForCategory,
  garmentSubtypeStrings,
} from '@couture/utils'
import { Text, createSchemeStyles } from '@/components/themed'
import { safeFindNodeHandle } from '@/src/lib/accessibility-focus'
import { releaseImagePickerCopy } from '@/src/lib/garment-capture-image'
import { currentUploadSession } from '@/src/lib/upload-attempts'

export function MobileFlatLayPicker({
  capture,
  onOpen,
}: {
  capture: FlatLayCapture
  onOpen: () => void
}) {
  const { i18n } = useTranslation()
  const picking = useRef(false)
  const openPicker = async () => {
    if (picking.current) return
    onOpen()
    const ticket = capture.open(currentUploadSession())
    picking.current = true
    let asset: ImagePicker.ImagePickerAsset | undefined
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: false,
      })
      asset = result.assets?.[0]
      if (result.canceled || !asset) return capture.cancelPick(ticket)
      if (!capture.isActive(ticket)) return
      if ((asset.fileSize ?? asset.file?.size ?? 0) > FLAT_LAY_MAX_PHOTO_BYTES) {
        return capture.cancelPick(ticket, 'uncertain')
      }

      const body = new FormData()
      if (asset.file) body.append('photo', asset.file, 'photo')
      else {
        // Native FormData resolves the selected file URI when it encodes the multipart part.
        body.append('photo', {
          uri: asset.uri,
          name: 'photo',
          type: asset.mimeType ?? 'image/jpeg',
        } as unknown as Blob)
      }
      await capture.review(ticket, body)
    } catch {
      capture.cancelPick(ticket, 'unavailable')
    } finally {
      picking.current = false
      if (asset) releaseImagePickerCopy(asset.uri)
    }
  }

  return (
    <FlatLayButton
      text={flatLayStrings(i18n.language).choose}
      onPress={() => void openPicker()}
    />
  )
}

function FlatLayButton({
  text,
  onPress,
  primary = false,
  disabled = false,
  label,
}: {
  text: string
  onPress: () => void
  primary?: boolean
  disabled?: boolean
  label?: string
}) {
  const themed = useThemedStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={label}
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={[
        styles.button,
        themed.outline,
        primary && themed.primary,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, primary && themed.primaryText]}>{text}</Text>
    </Pressable>
  )
}

function TagChoices<T extends string>({
  label,
  options,
  unset,
  name,
  current,
  select,
}: {
  label: string
  options: readonly T[]
  unset: string
  name: (option: T) => string
  current: T | null | undefined
  select: (option: T | null) => void
}) {
  const themed = useThemedStyles()
  return (
    <View style={styles.tagGroup}>
      <Text style={styles.buttonText}>{label}</Text>
      <View style={styles.actions}>
        {[null, ...options].map((option) => {
          const selected = (current ?? null) === option
          return (
            <Pressable
              key={option ?? 'unset'}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => select(option)}
              style={[styles.button, themed.outline, selected && themed.primary]}
            >
              <Text style={selected && themed.primaryText}>
                {option === null ? unset : name(option)}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function FlatLayTagForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: FlatLayTags
  onDone: (tags: FlatLayTags) => void
  onCancel: () => void
}) {
  const { t, i18n } = useTranslation()
  const copy = flatLayStrings(i18n.language)
  const subtype = garmentSubtypeStrings(i18n.language)
  const [tags, setTags] = useState(initial)
  const subtypes = garmentSubtypesForCategory(tags.category)
  const title = useRef<ElementRef<typeof NativeText>>(null)
  const themed = useThemedStyles()
  useEffect(() => focusNode(title.current), [])
  return (
    <ScrollView contentContainerStyle={styles.review}>
      <NativeText
        ref={title}
        accessible
        accessibilityRole="header"
        style={[styles.buttonText, themed.ink]}
      >
        {copy.edit}
      </NativeText>
      <TagChoices
        label={t('wardrobe.tagging.category')}
        unset={copy.unset}
        options={garmentCategoryEnum.options}
        current={tags.category}
        name={(value) => t(`wardrobe.tagging.options.category.${value}`)}
        select={(category) =>
          setTags({
            ...tags,
            category,
            subtype: category === tags.category ? tags.subtype : null,
          })
        }
      />
      {subtypes.length > 0 && (
        <TagChoices
          label={subtype.label}
          unset={subtype.none}
          options={subtypes}
          current={tags.subtype}
          name={(value) => subtype.values[value]}
          select={(value) => setTags({ ...tags, subtype: value })}
        />
      )}
      <TagChoices
        label={t('wardrobe.tagging.material')}
        unset={copy.unset}
        options={garmentMaterialEnum.options}
        current={tags.material}
        name={(value) => t(`wardrobe.tagging.options.material.${value}`)}
        select={(material) => setTags({ ...tags, material })}
      />
      <TagChoices
        label={t('wardrobe.tagging.comfort_range')}
        unset={copy.unset}
        options={garmentComfortRangeEnum.options}
        current={tags.comfortRange}
        name={(value) => t(`wardrobe.tagging.options.comfort.${value}`)}
        select={(comfortRange) => setTags({ ...tags, comfortRange })}
      />
      <View style={styles.actions}>
        <FlatLayButton text={t('wardrobe.detail.cancel')} onPress={onCancel} />
        <FlatLayButton
          text={t('wardrobe.detail.done')}
          primary
          onPress={() => onDone(tags)}
        />
      </View>
    </ScrollView>
  )
}

function focusNode(node: ElementRef<typeof NativeText> | null) {
  if (Platform.OS === 'web') return
  const handle = safeFindNodeHandle(node)
  if (handle) AccessibilityInfo.setAccessibilityFocus(handle)
}

export function MobileFlatLayReview({
  state,
  capture,
  onClose,
  title,
}: {
  state: FlatLayCaptureState
  capture: FlatLayCapture
  onClose: () => void
  title: RefObject<ElementRef<typeof NativeText> | null>
}) {
  const { t, i18n } = useTranslation()
  const copy = flatLayStrings(i18n.language)
  const themed = useThemedStyles()
  const [editingId, setEditingId] = useState<string | null>(null)
  const { pieces, phase } = state
  const editing = pieces.find((piece) => piece.id === editingId)
  useEffect(() => {
    if (!editing) focusNode(title.current)
  }, [editing, phase, title])

  if (editing)
    return (
      <FlatLayTagForm
        initial={editing.tags}
        onDone={(tags) => {
          capture.setTags(editing.id, tags)
          setEditingId(null)
        }}
        onCancel={() => setEditingId(null)}
      />
    )

  return (
    <ScrollView contentContainerStyle={styles.review}>
      {phase === 'scanning' && (
        <Text accessibilityLiveRegion="polite">{copy.scanning}</Text>
      )}
      {phase !== 'scanning' && (
        <View style={styles.grid}>
          {pieces.map(({ id, mask }, index) => {
            const label = `${copy.piece} ${index + 1}`
            return (
              <View key={id} style={[styles.piece, themed.outline]}>
                <Image
                  source={{ uri: `data:image/webp;base64,${mask}` }}
                  contentFit="contain"
                  cachePolicy="none"
                  accessible
                  accessibilityLabel={label}
                  style={[styles.preview, themed.preview]}
                />
                {phase === 'review' && (
                  <>
                    <FlatLayButton
                      text={copy.edit}
                      label={label}
                      onPress={() => setEditingId(id)}
                    />
                    <FlatLayButton
                      text={copy.remove}
                      label={label}
                      onPress={() => {
                        capture.remove(id)
                        focusNode(title.current)
                      }}
                    />
                  </>
                )}
              </View>
            )
          })}
        </View>
      )}
      <View style={styles.actions}>
        <FlatLayButton text={t('wardrobe.detail.cancel')} onPress={onClose} />
        {phase !== 'scanning' && (
          <FlatLayButton
            primary
            disabled={phase === 'saving' || pieces.length === 0}
            text={
              phase === 'saving'
                ? copy.saving
                : phase === 'retry'
                  ? copy.retry
                  : copy.add(pieces.length)
            }
            onPress={() => void capture.save()}
          />
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  review: { gap: 12, paddingBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  piece: { width: '48%', padding: 8, borderWidth: 1, borderRadius: 12, gap: 4 },
  preview: { width: '100%', aspectRatio: 1, borderRadius: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagGroup: { gap: 8 },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  buttonText: { fontWeight: '600' },
  disabled: { opacity: 0.6 },
})

const useThemedStyles = createSchemeStyles((colors) => ({
  outline: { borderColor: colors.lineStrong },
  primary: { backgroundColor: colors.inverse, borderColor: colors.inverse },
  primaryText: { color: colors.onInverse },
  preview: { backgroundColor: colors.cardMuted },
  ink: { color: colors.ink },
}))
