// 2026-11-19: the home header's way to the Profile page. On a wide screen the bottom nav is
// hidden, so this is where a member finds their profile. The label follows the reader's
// language; analytics records the English name.
'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'

export function ProfileNavLink({ className }: { className?: string }) {
  const { t } = useTranslation('translation', { i18n: getI18n() })
  return (
    <Link
      href="/settings"
      className={className}
      data-testid="nav-profile"
      data-ph-event="nav_link_clicked"
      data-ph-label="Profile"
      data-ph-href="/settings"
    >
      {t('nav.profile')}
    </Link>
  )
}
