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
      <legend className="lookbook-metrics mb-2 text-xs uppercase tracking-[0.12em] text-[#5C5C66]">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const optionId = `${id}-${option.value}`
          const checked = option.value === value
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={`flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#C9A14A] ${
                checked
                  ? 'border-[#111111] bg-[#111111] text-[#FFFFFF]'
                  : 'border-[#C9C9D1] bg-[#FFFFFF] text-[#111111] hover:border-[#C9A14A]'
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
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
