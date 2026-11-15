import type { Metadata } from 'next'
import Link from 'next/link'
import { ContactLink, LegalList, LegalPage, LegalSection } from '../components/legal-page'

export const metadata: Metadata = {
  title: 'CoutureCast Terms of Service',
  description: 'The rules for using CoutureCast, including age and guardian consent.',
}

const inlineLink = 'text-amber-200 underline underline-offset-4 hover:text-amber-100'

// Story 6.17: the age and consent terms follow the code paths the Privacy Policy names.
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      summary="These terms apply when you use CoutureCast on the web, iOS, or Android. By creating an account you agree to them."
    >
      <LegalSection title="Who can use CoutureCast">
        <LegalList>
          <li>
            You must be 13 or older. The service is not available to children under 13.
          </li>
          <li>
            If you are 13 to 15, your account stays limited until a guardian approves it,
            and a guardian can revoke that approval at any time.
          </li>
          <li>
            If you are 16 or older, you can use CoutureCast without guardian consent.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          Give your real birthdate and, for a teen account, a real guardian email address.
          We may restrict or close an account whose age or consent information is false,
          missing, or revoked. You can sign in with an email code or with Google; keep
          access to that email account secure.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          You keep ownership of the photos, wardrobe items, and posts you add. You let
          CoutureCast store, process, and display them to run the features you use, such
          as outfit plans and, for posts you share, the community feed.
        </p>
      </LegalSection>

      <LegalSection title="Community rules">
        <p>
          Post only photos you have the right to share. No harassment, hate, sexual
          content, or personal information about other people. Members can report posts
          and comments; moderators may remove content and limit accounts that break these
          rules.
        </p>
      </LegalSection>

      <LegalSection title="Subscriptions">
        <p>
          Premium subscriptions bought on the website are billed through Stripe, and you
          manage or cancel them from the billing portal linked in Settings. Subscriptions
          bought in the mobile app are billed by Apple or Google under their store terms,
          and you manage or cancel them there.
        </p>
      </LegalSection>

      <LegalSection title="The service">
        <p>
          Outfit plans are suggestions based on forecasts, which can be wrong. CoutureCast
          is provided as it is, and features may change or stop. We will update this page
          when these terms change.
        </p>
      </LegalSection>

      <LegalSection title="Privacy and contact">
        <p>
          The{' '}
          <Link href="/privacy" className={inlineLink}>
            Privacy Policy
          </Link>{' '}
          explains what we collect and how to have it deleted. Questions go to{' '}
          <ContactLink />.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
