'use client'

import Link from 'next/link'
import type { RefObject } from 'react'
import type { GuestPreviewStrings } from '@couture/utils'
import { AccessibleModal } from '../accessible-modal'

const accountDoors = [
  { href: '/signup?from=preview', action: 'create_account', id: 'create-account' },
  { href: '/signin?from=preview', action: 'sign_in', id: 'sign-in' },
] as const

export function GuestPreviewSaveSheet({
  isOpen,
  strings,
  invokerRef,
  onClose,
  onChoose,
}: {
  isOpen: boolean
  strings: GuestPreviewStrings
  invokerRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onChoose: (action: (typeof accountDoors)[number]['action']) => boolean
}) {
  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="guest-preview-save-title"
      title={strings.firstRun.saveTitle}
      descriptionId="guest-preview-save-description"
      description={strings.firstRun.saveBody}
      closeLabel={strings.chrome.close}
      invokingElementRef={invokerRef}
      testId="guest-preview-save-sheet"
      onBeforeLinkNavigate={(href) => {
        const door = accountDoors.find((item) => item.href === href)
        return Boolean(door && onChoose(door.action))
      }}
    >
      <div className="mt-4 flex flex-wrap gap-3">
        {accountDoors.map(({ href, action, id }) => (
          <Link
            key={id}
            href={href}
            data-testid={`guest-preview-${id}`}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ${action === 'create_account' ? 'bg-inverse text-on-inverse' : 'border border-line-strong bg-page text-ink'}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                event.preventDefault()
                return
              }
              if (!onChoose(action)) event.preventDefault()
            }}
          >
            {action === 'create_account'
              ? strings.chrome.createAccount
              : strings.chrome.signIn}
          </Link>
        ))}
        <button
          type="button"
          onClick={onClose}
          data-testid="guest-preview-save-cancel"
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-ink underline underline-offset-4"
        >
          {strings.firstRun.cancel}
        </button>
      </div>
    </AccessibleModal>
  )
}
