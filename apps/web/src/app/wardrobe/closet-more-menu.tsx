// Story CC-7.11 D5 owner: the Closet top bar More menu (closet setup and Silhouette).
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
'use client'

import Link from 'next/link'
import React, { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

const ITEM_CLASS =
  'flex min-h-touch w-full items-center whitespace-nowrap rounded-md px-3 text-sm font-medium text-ink hover:bg-card-muted focus-visible:bg-card-muted'

/**
 * A neutral More button with a `menu` popover anchored below it. Escape, an outside click or a
 * Tab away closes it, and Escape returns focus to More. Arrow keys move between the items.
 */
export function ClosetMoreMenu({ setupDone }: { setupDone: boolean }) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      list[(index + 1) % list.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      list[(index - 1 + list.length) % list.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      list[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      list[list.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid="closet-more-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('wardrobe.menu.label')}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="flex min-h-touch min-w-touch items-center justify-center rounded-lg border border-line-strong bg-page px-3 text-sm font-semibold text-ink"
      >
        {t('wardrobe.menu.more')}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('wardrobe.menu.label')}
          data-testid="closet-more-menu-popover"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-40 mt-2 flex min-w-48 flex-col gap-1 rounded-lg border border-line bg-page p-2 shadow-overlay"
        >
          <Link
            href="/wardrobe/onboarding"
            role="menuitem"
            data-testid="closet-more-setup"
            onClick={() => setOpen(false)}
            className={ITEM_CLASS}
          >
            {setupDone ? t('wardrobe.menu.setupDone') : t('wardrobe.menu.setup')}
          </Link>
          <Link
            href="/wardrobe/silhouette"
            role="menuitem"
            data-testid="closet-more-silhouette"
            onClick={() => setOpen(false)}
            className={ITEM_CLASS}
          >
            {t('wardrobe.menu.silhouette')}
          </Link>
        </div>
      )}
    </div>
  )
}
