'use client'

// Story 6.10 web owner: the queue filter bar. Each control takes one value and applies on change.
import { useId, type ReactNode } from 'react'
import {
  moderationCaseRiskSchema,
  moderationCaseSlaStateSchema,
  moderationCaseSourceSchema,
  moderationCaseStatusSchema,
} from '@couture/api-client/contracts/http'
import {
  type ModerationQueueFilters,
  useModerationTranslation,
} from '../../lib/moderation'
import { SUPPORTED_LOCALES } from '../../i18n'

const field =
  'min-h-[44px] w-full rounded border border-neutral-500 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-essential)] dark:bg-neutral-900 dark:text-neutral-100'

type Key = 'source' | 'locale' | 'risk' | 'sla'

export function ModerationFilters({
  value,
  onChange,
}: {
  value: ModerationQueueFilters
  onChange: (next: ModerationQueueFilters) => void
}) {
  const { t } = useModerationTranslation()
  const set = (key: Key, raw: string) =>
    onChange({ ...value, [key]: raw === '' ? undefined : raw } as ModerationQueueFilters)
  const id = useId()
  const labeled = (key: string, children: ReactNode) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${key}`} className="text-sm font-medium">
        {t(`moderation.filters.${key}`)}
      </label>
      {children}
    </div>
  )
  const select = (
    key: Key,
    options: readonly string[],
    label: (option: string) => string
  ) =>
    labeled(
      key,
      <select
        id={`${id}-${key}`}
        className={field}
        value={value[key] ?? ''}
        onChange={(event) => set(key, event.target.value)}
      >
        <option value="">{t('moderation.filters.any')}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {label(option)}
          </option>
        ))}
      </select>
    )

  return (
    <form
      role="search"
      aria-label={t('moderation.filters.label')}
      onSubmit={(event) => event.preventDefault()}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      {select('source', moderationCaseSourceSchema.options, (o) =>
        t(`moderation.source.${o}`)
      )}
      {select('locale', [...SUPPORTED_LOCALES, 'unknown'], (o) =>
        o === 'unknown' ? t('moderation.filters.localeUnknown') : o
      )}
      {select('risk', moderationCaseRiskSchema.options, (o) => t(`moderation.risk.${o}`))}
      {labeled(
        'status',
        <select
          id={`${id}-status`}
          className={field}
          value={value.status}
          onChange={(event) =>
            onChange({
              ...value,
              status: moderationCaseStatusSchema.parse(event.target.value),
            })
          }
        >
          {moderationCaseStatusSchema.options.map((option) => (
            <option key={option} value={option}>
              {t(`moderation.status.${option}`)}
            </option>
          ))}
        </select>
      )}
      {select('sla', moderationCaseSlaStateSchema.options, (o) =>
        t(`moderation.slaState.${o}`)
      )}
    </form>
  )
}
