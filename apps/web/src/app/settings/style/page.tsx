// Story CC-7.11 D7 owner: Profile > Style, the sub-screen that holds Silhouette, closet setup and
// the color palette.
// Learning path Step 68: Five-tab navigation and back pattern.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-68-five-tab-navigation-and-back-pattern
'use client'

import { useTranslation } from 'react-i18next'
import { NavRow } from '../../components/nav-row'
import { useWebStyleProfile } from '../../../lib/style-profile'
import { StyleMemberControls } from '../../components/style-profile-controls'
import { SettingsDestination } from '../settings-destination'

function StyleRows() {
  const { t } = useTranslation()
  const style = useWebStyleProfile()
  return (
    <>
      <StyleMemberControls key={style.scope} style={style} showClear />
      <nav aria-label={t('settings.style.title')} data-testid="style-rows">
        <NavRow
          href="/wardrobe/silhouette"
          label={t('settings.style.silhouette')}
          testId="style-row-silhouette"
        />
        <NavRow
          href="/wardrobe/onboarding"
          label={t('settings.style.closetSetup')}
          testId="style-row-setup"
        />
        <NavRow
          href="/palette"
          label={t('settings.style.palette')}
          testId="style-row-palette"
        />
      </nav>
    </>
  )
}

/** D10: the top bar with back; a direct entry goes back to Profile. */
export default function SettingsStylePage() {
  return (
    <SettingsDestination topic="style">
      <StyleRows />
    </SettingsDestination>
  )
}
