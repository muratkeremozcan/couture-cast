'use client'
// Story 6.16 AC8: one native radio group for every preview control, so keyboard and
// screen readers get real radio semantics and each option is at least 44 px tall.
import { useId } from 'react'

export function GuestPreviewChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  testId,
}: {
  legend: string
  name: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  testId: string
}) {
  const id = useId()
  return (
    <fieldset data-testid={testId} className="min-w-0 space-y-2">
      <legend className="mb-2 max-w-full text-xs uppercase tracking-[0.12em] text-ink-muted [overflow-wrap:anywhere]">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`
          const checked = option.value === value
          // The radio is visually hidden, so its label draws the same ring the global
          // `*:focus-visible` rule would (Story CC-7.9 D3).
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={`flex min-h-11 min-w-0 max-w-full cursor-pointer items-center rounded-full border px-2 text-sm min-[361px]:px-4 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-essential has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-focus ${
                checked
                  ? 'border-inverse bg-inverse text-on-inverse'
                  : 'border-line-strong bg-page text-ink hover:border-ink'
              }`}
            >
              <input
                id={optionId}
                type="radio"
                name={`${name}-${id}`}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                data-testid={`${testId}-${option.value}`}
                className="sr-only"
              />
              <span className="min-w-0 hyphens-auto [overflow-wrap:anywhere]">
                {option.label}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
