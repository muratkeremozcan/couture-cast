import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ContactLink,
  LEGAL_INLINE_LINK_CLASS,
  LegalList,
  LegalPage,
  LegalSection,
} from '../components/legal-page'

export const metadata: Metadata = {
  title: 'CoutureCast Terms of Service',
  description: 'The rules for using CoutureCast, including who can use it.',
}

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
        </LegalList>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          Give your real birthdate. We may restrict or close an account whose age
          information is false or missing. You can sign in with an email code or with
          Google; keep access to that email account secure.
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
          manage or cancel them from the billing portal linked in Profile. The mobile apps
          do not offer in-app subscriptions yet; when they do, Apple or Google will bill
          them under their store terms.
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
          <Link href="/privacy" className={LEGAL_INLINE_LINK_CLASS}>
            Privacy Policy
          </Link>{' '}
          explains what we collect and how to have it deleted. Questions go to{' '}
          <ContactLink />.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
