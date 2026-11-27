'use client'

import { useEffect, useId, useRef, useState } from 'react'
import {
  formatPreviewString,
  garmentSubtypeStrings,
  sampleGarmentText,
  todayCatalogSlot,
  todaySlotCatalogItem,
  type GuestPreviewStrings,
  type SampleSwapOptions,
  type TodaySlot,
} from '@couture/utils'
import { AccessibleModal } from './accessible-modal'
import { SampleGarmentArt } from './guest-preview/sample-garment-art'
import {
  SampleSwapRows,
  type SampleSwapOptionFocus,
} from './guest-preview/sample-swap-rows'

function slotName(
  slot: TodaySlot,
  strings: GuestPreviewStrings,
  locale: string | undefined
) {
  const item = todaySlotCatalogItem(slot)
  return item
    ? sampleGarmentText(item, strings).name
    : slot.subtype
      ? garmentSubtypeStrings(locale).values[slot.subtype]
      : strings.values.category[slot.category]
}

function SlotArt({ slot, index }: { slot: TodaySlot; index?: number }) {
  const access = slot.imageAccess
  const [loadedUrl, setLoadedUrl] = useState<string>()
  const [unavailableUrl, setUnavailableUrl] = useState<string>()
  const url =
    access && Date.parse(access.expiresAt) > Date.now() && unavailableUrl !== access.url
      ? access.url
      : undefined
  const loaded = url !== undefined && loadedUrl === url

  useEffect(() => {
    if (!access) return
    const remaining = Date.parse(access.expiresAt) - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(() => setUnavailableUrl(access.url), remaining)
    return () => clearTimeout(timer)
  }, [access])

  return (
    <>
      <span
        aria-hidden="true"
        data-testid={
          !loaded && index !== undefined ? `today-outfit-catalog-${index}` : undefined
        }
        className="absolute inset-0 grid place-items-center"
      >
        <SampleGarmentArt garment={slot} className="h-full w-full max-w-24 p-1" />
      </span>
      {url && (
        // Signed wardrobe photos bypass optimization and never carry the page referrer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          data-testid={
            loaded && index !== undefined ? `today-outfit-photo-${index}` : undefined
          }
          className={`absolute inset-0 h-full w-full bg-card-muted object-contain ${loaded ? '' : 'opacity-0'}`}
          onLoad={() => setLoadedUrl(url)}
          onError={() => setUnavailableUrl(url)}
        />
      )}
    </>
  )
}

export function TodayOutfitPicture({
  slots,
  strings,
  locale,
  getOptions,
  getSampleOptions,
  onChoose,
}: {
  slots: readonly TodaySlot[]
  strings: GuestPreviewStrings
  locale?: string
  getOptions?: (index: number) => readonly TodaySlot[]
  getSampleOptions?: (index: number) => SampleSwapOptions | undefined
  onChoose: (index: number, slot: TodaySlot) => void
}) {
  const [swappingIndex, setSwappingIndex] = useState<number | null>(null)
  const invoker = useRef<HTMLButtonElement | null>(null)
  const firstOption = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const current = swappingIndex !== null ? slots[swappingIndex] : undefined
  const category = current ? strings.values.category[current.category] : ''
  const options = swappingIndex !== null ? (getOptions?.(swappingIndex) ?? []) : []
  const sampleOptions =
    swappingIndex !== null ? getSampleOptions?.(swappingIndex) : undefined
  const title = formatPreviewString(strings.outfit.swapTitle, { category })

  const renderOption = (
    slot: TodaySlot,
    index: number,
    selected: boolean,
    name = slotName(slot, strings, locale),
    focus?: SampleSwapOptionFocus
  ) => (
    <button
      type="button"
      key={slot.itemId}
      ref={index === 0 ? firstOption : undefined}
      data-testid={`today-outfit-swap-option-${index}`}
      data-garment-id={slot.itemId}
      role="radio"
      aria-checked={selected}
      {...focus}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-line-strong px-2 py-1 text-start text-sm hover:border-ink"
      onClick={() => {
        if (swappingIndex !== null && !selected) onChoose(swappingIndex, slot)
        setSwappingIndex(null)
      }}
    >
      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-card-muted">
        <SlotArt slot={slot} />
      </span>
      <span>{name}</span>
      {selected && (
        <span className="text-xs text-ink-muted">{strings.outfit.current}</span>
      )}
    </button>
  )

  return (
    <>
      <div
        data-testid="today-outfit-picture"
        className={`grid h-[176px] grid-cols-3 auto-rows-[80px] gap-2 overflow-y-auto rounded-lg bg-page p-1 ${slots.length <= 3 ? 'content-center' : ''}`}
      >
        {slots.map((slot, index) => (
          <button
            type="button"
            key={index}
            data-testid={`today-outfit-slot-${index}`}
            aria-label={`${formatPreviewString(strings.outfit.swap, { category: strings.values.category[slot.category] })}: ${slotName(slot, strings, locale)}`}
            aria-haspopup="dialog"
            className="relative min-h-touch min-w-touch overflow-hidden rounded-md border border-line bg-card-muted hover:border-ink"
            onClick={(event) => {
              invoker.current = event.currentTarget
              setSwappingIndex(index)
            }}
          >
            <SlotArt key={slot.itemId} slot={slot} index={index} />
          </button>
        ))}
      </div>
      <AccessibleModal
        isOpen={current !== undefined}
        onClose={() => setSwappingIndex(null)}
        titleId={titleId}
        title={title}
        invokingElementRef={invoker}
        initialFocusRef={firstOption}
        closeLabel={strings.chrome.close}
      >
        {sampleOptions ? (
          <SampleSwapRows
            options={sampleOptions}
            label={title}
            strings={strings}
            testId="today-outfit-swap"
            showMoreTestId="today-outfit-swap-show-more"
            renderOption={(garment, index, selected, focus) =>
              renderOption(
                todayCatalogSlot(garment),
                index,
                selected,
                sampleGarmentText(garment, strings).name,
                focus
              )
            }
          />
        ) : (
          <div
            data-testid="today-outfit-swap"
            role="radiogroup"
            aria-labelledby={titleId}
            className="space-y-2"
          >
            {options.map((slot, index) => renderOption(slot, index, index === 0))}
            {options.length === 1 && (
              <p className="text-sm text-ink-muted">
                {strings.outfit.noSuitableAlternative}
              </p>
            )}
          </div>
        )}
      </AccessibleModal>
    </>
  )
}
