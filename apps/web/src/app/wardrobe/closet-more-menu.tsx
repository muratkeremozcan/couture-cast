// Story CC-7.11 D5 owner: the Closet top bar More menu (closet setup and Silhouette).
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
'use client'

import Link from 'next/link'
import React, { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

const ITEM_CLASS =
  'flex min-h-touch w-full items-center rounded-md px-3 py-1 [overflow-wrap:anywhere] text-sm font-medium text-ink hover:bg-card-muted focus-visible:bg-card-muted'

/**
 * A neutral More button with a `menu` popover anchored below it. Escape, an outside click or a
 * Tab away closes it; Escape, and an outside click that lands on nothing focusable, return focus
 * to More. Arrow keys move between the items.
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
      // Review #14: a press on something that takes focus keeps it; one on plain chrome would
      // leave focus on the removed item, so it returns to More.
      const focusable =
        target instanceof Element &&
        target.closest(
          'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'
        )
      // After the press's own focus change, which moves focus to the body.
      if (!focusable) window.setTimeout(() => buttonRef.current?.focus(), 0)
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
    <div className="relative min-w-0 max-w-full">
      <button
        ref={buttonRef}
        type="button"
        data-testid="closet-more-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // WCAG 2.5.3: the name starts with the visible word ("More closet options").
        aria-label={t('wardrobe.menu.moreLabel')}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="flex min-h-touch max-w-full items-center justify-center rounded-lg border border-line-strong bg-page px-2 py-1 text-sm font-semibold text-ink [overflow-wrap:anywhere]"
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
          className="absolute right-0 top-full z-40 mt-2 flex w-max max-w-[calc(100vw-3rem)] flex-col gap-1 rounded-lg border border-line bg-page p-2 shadow-overlay"
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
