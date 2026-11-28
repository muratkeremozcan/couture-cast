'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type FlatLayCapture, type FlatLayCaptureState } from '@couture/api-client'
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
import { currentUploadSession } from '../../lib/upload-attempts'

const secondary =
  'min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink disabled:opacity-60'
const primary =
  'min-h-11 rounded-lg bg-inverse px-4 text-sm font-semibold text-on-inverse disabled:opacity-60'

export function FlatLayPicker({
  capture,
  onOpen,
}: {
  capture: FlatLayCapture
  onOpen: () => void
}) {
  const { i18n } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const ticket = useRef<ReturnType<FlatLayCapture['open']> | null>(null)
  useEffect(() => {
    const picker = input.current
    const cancel = () => {
      if (ticket.current) capture.cancelPick(ticket.current)
      ticket.current = null
    }
    picker?.addEventListener('cancel', cancel)
    return () => picker?.removeEventListener('cancel', cancel)
  }, [capture])
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          const picked = ticket.current
          ticket.current = null
          if (!picked || !file || !capture.isActive(picked)) return
          if (file.size === 0 || file.size > FLAT_LAY_MAX_PHOTO_BYTES) {
            capture.cancelPick(picked, 'uncertain')
            return
          }
          const form = new FormData()
          form.append('photo', file, 'photo')
          void capture.review(picked, form)
        }}
      />
      <button
        type="button"
        className={secondary}
        onClick={() => {
          onOpen()
          ticket.current = capture.open(currentUploadSession())
          input.current?.click()
        }}
      >
        {flatLayStrings(i18n.language).choose}
      </button>
    </>
  )
}

function TagField<T extends string>({
  label,
  unset,
  value,
  options,
  name,
  onChange,
  fieldRef,
}: {
  label: string
  unset: string
  value: T | null | undefined
  options: readonly T[]
  name: (option: T) => string
  onChange: (value: T | null) => void
  fieldRef?: React.Ref<HTMLSelectElement>
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
      {label}
      <select
        ref={fieldRef}
        className="min-h-11 rounded-lg border border-line-strong bg-page px-2"
        value={value ?? ''}
        onChange={(event) => {
          const value =
            options.find((option) => option === event.currentTarget.value) ?? null
          onChange(value)
        }}
      >
        <option value="">{unset}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {name(option)}
          </option>
        ))}
      </select>
    </label>
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
  const categoryRef = useRef<HTMLSelectElement>(null)
  const subtypes = garmentSubtypesForCategory(tags.category)
  useLayoutEffect(() => categoryRef.current?.focus(), [])
  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onDone(tags)
      }}
    >
      <TagField
        label={t('wardrobe.detail.category')}
        unset={copy.unset}
        value={tags.category}
        options={garmentCategoryEnum.options}
        name={(value) => t(`wardrobe.tagEditor.category.${value}`)}
        onChange={(category) =>
          setTags({
            ...tags,
            category,
            subtype: category === tags.category ? tags.subtype : null,
          })
        }
        fieldRef={categoryRef}
      />
      {subtypes.length > 0 && (
        <TagField
          label={subtype.label}
          unset={subtype.none}
          value={tags.subtype}
          options={subtypes}
          name={(value) => subtype.values[value]}
          onChange={(value) => setTags({ ...tags, subtype: value })}
        />
      )}
      <TagField
        label={t('wardrobe.detail.material')}
        unset={copy.unset}
        value={tags.material}
        options={garmentMaterialEnum.options}
        name={(value) => t(`wardrobe.tagEditor.material.${value}`)}
        onChange={(material) => setTags({ ...tags, material })}
      />
      <TagField
        label={t('wardrobe.detail.comfort')}
        unset={copy.unset}
        value={tags.comfortRange}
        options={garmentComfortRangeEnum.options}
        name={(value) => t(`wardrobe.tagEditor.comfort.${value}.label`)}
        onChange={(comfortRange) => setTags({ ...tags, comfortRange })}
      />
      <div className="flex justify-end gap-2">
        <button type="button" className={secondary} onClick={onCancel}>
          {t('wardrobe.capture.cancel')}
        </button>
        <button type="submit" className={primary}>
          {t('wardrobe.capture.done')}
        </button>
      </div>
    </form>
  )
}

export function FlatLayReviewGrid({
  state,
  capture,
  onClose,
}: {
  state: FlatLayCaptureState
  capture: FlatLayCapture
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const copy = flatLayStrings(i18n.language)
  const focus = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editInvoker = useRef<string | null>(null)
  const { pieces, phase } = state
  const editing = pieces.find((piece) => piece.id === editingId)
  useLayoutEffect(() => {
    if (editing) return
    const invoker =
      editInvoker.current &&
      document.getElementById(`flat-lay-edit-${editInvoker.current}`)
    const target = invoker || focus.current
    target?.focus()
  }, [editing, phase])

  if (editing) {
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
  }

  return (
    <div ref={focus} tabIndex={-1} className="mt-4 flex flex-col gap-4">
      {phase === 'scanning' ? (
        <p role="status">{copy.scanning}</p>
      ) : (
        <ul role="list" className="grid grid-cols-2 gap-2 sm:gap-3">
          {pieces.map(({ id, mask }, index) => {
            const label = `${copy.piece} ${index + 1}`
            return (
              <li key={id} className="min-w-0 rounded-lg border border-line bg-page p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/webp;base64,${mask}`}
                  alt={label}
                  className="aspect-square w-full rounded-md bg-card-muted object-contain"
                />
                {phase === 'review' && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button
                      type="button"
                      id={`flat-lay-edit-${id}`}
                      className={secondary}
                      aria-describedby={`flat-lay-${id}`}
                      onClick={() => {
                        editInvoker.current = id
                        setEditingId(id)
                      }}
                    >
                      {copy.edit}
                    </button>
                    <button
                      type="button"
                      className={secondary}
                      aria-describedby={`flat-lay-${id}`}
                      onClick={() => {
                        editInvoker.current = null
                        capture.remove(id)
                        focus.current?.focus()
                      }}
                    >
                      {copy.remove}
                    </button>
                    <span className="sr-only" id={`flat-lay-${id}`}>
                      {label}
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={secondary} onClick={onClose}>
          {t('wardrobe.capture.cancel')}
        </button>
        {phase !== 'scanning' && (
          <button
            type="button"
            className={primary}
            disabled={phase === 'saving' || pieces.length === 0}
            onClick={() => void capture.save()}
          >
            {phase === 'saving'
              ? copy.saving
              : phase === 'retry'
                ? copy.retry
                : copy.add(pieces.length)}
          </button>
        )}
      </div>
    </div>
  )
}
