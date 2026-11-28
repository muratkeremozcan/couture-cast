import { PhotoAiConsent } from '../../components/photo-ai-consent'
import { ProfileAccount } from '../../components/profile-account'
import { SettingsDestination } from '../settings-destination'

export default function AccountPage() {
  return (
    <SettingsDestination topic="account">
      <ProfileAccount />
      <PhotoAiConsent />
    </SettingsDestination>
  )
}
