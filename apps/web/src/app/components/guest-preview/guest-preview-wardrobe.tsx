'use client'
// Story 6.16 D6: browse the sample wardrobe by category and collection, inspect an item,
// and return to the outfit with every choice kept.
import { useRef, useState } from 'react'
import {
  formatPreviewString,
  SAMPLE_COLLECTION_FILTERS,
  sampleGarmentText,
  sampleWardrobeCategories,
  sampleWardrobeItems,
  type GuestPreviewStrings,
  type SampleCollectionFilter,
  type SampleGarment,
  type SampleWardrobeFilter,
} from '@couture/utils'
import { AccessibleModal } from '../accessible-modal'
import { GuestPreviewChoiceGroup } from './guest-preview-choice-group'
import { SampleGarmentArt } from './sample-garment-art'

export function GuestPreviewWardrobe({
  strings,
  collection,
  usableIds,
  onCollection,
  onUse,
  onInspect,
  onBackToOutfit,
  onCategory,
  inPicker = false,
}: {
  strings: GuestPreviewStrings
  collection: SampleCollectionFilter
  usableIds: Pick<ReadonlySet<string>, 'has'>
  onCollection: (collection: SampleCollectionFilter) => void
  onUse: (garment: SampleGarment) => void
  onInspect?: () => void
  onBackToOutfit: () => void
  onCategory?: () => void
  inPicker?: boolean
}) {
  const [category, setCategory] = useState<SampleWardrobeFilter>('all')
  const [open, setOpen] = useState<SampleGarment | null>(null)
  const invoker = useRef<HTMLElement | null>(null)
  const { values } = strings
  const items = sampleWardrobeItems(category, collection)
  const openText = open ? sampleGarmentText(open, strings) : null

  return (
    <section
      aria-labelledby={inPicker ? undefined : 'guest-preview-wardrobe-heading'}
      data-testid="guest-preview-wardrobe"
      className="space-y-5"
    >
      {!inPicker && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="guest-preview-wardrobe-heading"
            className="text-2xl font-semibold text-ink"
          >
            {strings.wardrobe.heading}
          </h2>
          <button
            type="button"
            onClick={onBackToOutfit}
            data-testid="guest-preview-back-to-outfit"
            className="min-h-11 rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink"
          >
            {strings.wardrobe.backToOutfit}
          </button>
        </div>
      )}
      <GuestPreviewChoiceGroup
        legend={strings.wardrobe.category}
        name="category"
        testId="guest-preview-category"
        value={category}
        options={sampleWardrobeCategories(strings)}
        onChange={(next) => {
          setCategory(next)
          onCategory?.()
        }}
      />
      <GuestPreviewChoiceGroup
        legend={strings.preferences.collection}
        name="collection"
        testId="guest-preview-collection"
        value={collection}
        options={SAMPLE_COLLECTION_FILTERS.map((key) => ({
          value: key,
          label: values.collection[key],
        }))}
        onChange={onCollection}
      />
      <p
        role="status"
        className="text-sm text-ink-muted"
        data-testid="guest-preview-item-count"
      >
        {items.length === 0
          ? strings.wardrobe.empty
          : formatPreviewString(strings.wardrobe.count, { count: items.length })}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((garment) => {
          const text = sampleGarmentText(garment, strings)
          return (
            <li key={garment.id}>
              <button
                type="button"
                data-testid="guest-preview-item"
                data-garment-id={garment.id}
                data-surface="card"
                onClick={(event) => {
                  invoker.current = event.currentTarget
                  setOpen(garment)
                  onInspect?.()
                }}
                className="flex min-h-11 w-full flex-col items-center gap-2 rounded-xl border border-line bg-card p-3 text-center hover:border-line-strong"
              >
                <SampleGarmentArt garment={garment} />
                <span className="text-sm font-medium text-ink">{text.name}</span>
                <span className="text-xs text-ink-muted">
                  {values.categoryTitle[garment.category]}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <AccessibleModal
        isOpen={open !== null}
        onClose={() => setOpen(null)}
        titleId="guest-preview-item-title"
        title={openText?.name ?? ''}
        description={strings.chrome.sampleLabel}
        descriptionId="guest-preview-item-label"
        invokingElementRef={invoker}
        closeLabel={strings.chrome.close}
      >
        {open && openText ? (
          <div className="space-y-4" data-testid="guest-preview-item-detail">
            <div className="flex items-center gap-4">
              <span className="rounded-lg bg-card-muted p-2">
                <SampleGarmentArt
                  garment={open}
                  label={openText.description}
                  className="h-24 w-24"
                />
              </span>
              <p className="text-sm">{openText.description}</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-medium">{strings.wardrobe.category}</dt>
              <dd>{values.categoryTitle[open.category]}</dd>
              {open.material ? (
                <>
                  <dt className="font-medium">{strings.wardrobe.material}</dt>
                  <dd>{values.material[open.material]}</dd>
                </>
              ) : null}
              <dt className="font-medium">{strings.wardrobe.comfortRange}</dt>
              <dd>{open.comfortRanges.map((range) => values.range[range]).join(', ')}</dd>
              <dt className="font-medium">{strings.wardrobe.windResistant}</dt>
              <dd>{open.windResistant ? strings.wardrobe.yes : strings.wardrobe.no}</dd>
              <dt className="font-medium">{strings.wardrobe.waterResistant}</dt>
              <dd>{open.waterResistant ? strings.wardrobe.yes : strings.wardrobe.no}</dd>
            </dl>
            {usableIds.has(open.id) ? (
              <button
                type="button"
                data-testid="guest-preview-use-item"
                onClick={() => {
                  onUse(open)
                  setOpen(null)
                }}
                // Story CC-7.9 D3: gold is the screen's main action only; this is a neutral outline.
                className="min-h-11 w-full rounded-lg border border-line-strong bg-page px-4 text-sm font-semibold text-ink"
              >
                {strings.wardrobe.useItem}
              </button>
            ) : null}
          </div>
        ) : null}
      </AccessibleModal>
    </section>
  )
}
