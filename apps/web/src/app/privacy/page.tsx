import type { Metadata } from 'next'
import Link from 'next/link'
import { ContactLink, LegalList, LegalPage, LegalSection } from '../components/legal-page'

export const metadata: Metadata = {
  title: 'CoutureCast Privacy Policy',
  description:
    'What CoutureCast collects, why, who processes it, and how to have it deleted.',
}

// Story 6.17: every statement here is backed by code; the comment beside each block names it.
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary="CoutureCast plans outfits from the weather and your wardrobe. This page explains what we collect to do that, who processes it for us, and how to have it deleted."
    >
      {/* Age gate: packages/utils/src/age.ts, apps/api auth.service signup paths. */}
      <LegalSection title="Who can use CoutureCast">
        <p>
          CoutureCast is for people aged 13 and older. Every signup, with email or with
          Google, asks for a birthdate. Nobody under 13 can create an account. People aged
          13 to 15 can create an account, but wardrobe features stay locked until a
          guardian approves.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <LegalList>
          <li>
            <strong>Your email address</strong>, to sign you in with a one-time code or
            with Google.
          </li>
          <li>
            <strong>Your birthdate</strong>, to apply the age rules above.
          </li>
          <li>
            <strong>For accounts aged 13 to 15</strong>: the guardian email address the
            teen enters, and the guardian&apos;s consent record (consent level, time, and
            the IP address the guardian approved from).
          </li>
          <li>
            <strong>What you add to the app</strong>: wardrobe items and their photos, an
            optional My Form photo for fit suggestions, comfort settings, saved places for
            forecasts, and anything you post or comment in the community.
          </li>
        </LegalList>
      </LegalSection>

      {/* Story 6.17 D4: the app reads only the verified address. Both clients store the session
          through withoutProviderTokens (@couture/utils), which drops Google's tokens. */}
      <LegalSection title="Signing in with Google">
        <p>
          When you choose Continue with Google, Google shares your email address, name,
          and profile photo with Supabase Auth, the sign-in service CoutureCast uses.
          Supabase keeps them with your sign-in identity. CoutureCast reads only your
          verified email address: it never copies your Google name or photo into its own
          records. No Google token is kept on our servers or in the sign-in session stored
          on your device.
        </p>
        <p>
          A new Google sign-in becomes a CoutureCast account only after you enter your
          birthdate. Until then we hold the sign-in identity alone, and we delete it in
          these cases:
        </p>
        <LegalList>
          <li>
            The birthdate shows you are under 13: we delete it right away, or, if that
            attempt fails, our daily cleanup deletes it once it is more than a day old.
          </li>
          <li>You choose Cancel on the birthdate step: we delete it right away.</li>
          <li>
            You leave without finishing: once it is more than a day old, our daily cleanup
            deletes it.
          </li>
        </LegalList>
      </LegalSection>

      {/* Guardian flow: apps/api guardian.service.ts and the guardian dashboard. */}
      <LegalSection title="Guardian consent for ages 13 to 15">
        <p>
          A teen aged 13 to 15 enters a guardian&apos;s email address. The guardian
          follows the invitation link to approve the account with read-only or full
          access. Until a guardian approves, the teen cannot use wardrobe features.
        </p>
        <p>
          A guardian can revoke consent at any time from the guardian dashboard. When the
          last guardian revokes, the teen&apos;s wardrobe access stops again. Guardians
          can ask to review or delete a teen&apos;s information by writing to the address
          below.
        </p>
      </LegalSection>

      {/* Web: apps/web/src/analytics/browser-analytics.ts through the /ingest proxy. Mobile:
          apps/mobile/src/config/posthog.ts, direct to PostHog. Server: telemetry.service.ts,
          keyed ids; profile_completed carries age and guardian_consent_required. */}
      <LegalSection title="Analytics">
        <p>
          We use PostHog to count page views, a fixed list of product events, and errors.
          The website sends them through our own servers; the mobile app sends them to
          PostHog directly. Events carry a pseudonymous identifier, never your email
          address or a sign-in code. The event recorded when you finish signup also
          carries your age and whether guardian consent is required. Session recording,
          heatmaps, and automatic click capture are off.
        </p>
      </LegalSection>

      <LegalSection title="Who processes your information">
        <p>CoutureCast does not sell personal information. These services run it:</p>
        <LegalList>
          <li>Supabase: sign-in, the database, and photo storage.</li>
          <li>Vercel: the website and the app&apos;s server functions.</li>
          <li>Northflank and Upstash: background jobs and their queues.</li>
          <li>PostHog: the analytics described above.</li>
          <li>Grafana Cloud: performance traces and metrics from our servers.</li>
          <li>
            OpenWeather: forecasts and place search. It receives the place or city you
            enter.
          </li>
          <li>
            Expo, with Apple and Google delivery: push notifications you turn on in the
            mobile app.
          </li>
          <li>Stripe: payment for subscriptions bought on the website.</li>
          <li>Google: only if you choose to sign in with Google.</li>
        </LegalList>
      </LegalSection>

      {/* Story 6.13 D6: POST /api/v1/moderation/erasure-requests, 72-hour completion. */}
      <LegalSection title="Deleting your account">
        <p>
          Write to <ContactLink /> from the email address on your account and ask for
          deletion. We start account erasure, which removes your community posts and
          comments and the personal details in their moderation records within 72 hours,
          and we delete the rest of your account data by hand.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions, review requests, and deletion requests go to <ContactLink />. The{' '}
          <Link
            href="/terms"
            className="text-amber-200 underline underline-offset-4 hover:text-amber-100"
          >
            Terms of Service
          </Link>{' '}
          cover the rules for using CoutureCast.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
