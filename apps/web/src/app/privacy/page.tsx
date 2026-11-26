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
      {/* Age gate: packages/utils/src/age.ts (GUARDIAN_CONSENT_POLICY off since 2026-11-16),
          apps/api auth.service signup paths. */}
      <LegalSection title="Who can use CoutureCast">
        <p>
          CoutureCast is for people aged 13 and older. Every signup, with email or with
          Google, asks for a birthdate. Nobody under 13 can create an account.
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
          <li>
            You choose Cancel on the birthdate step: we delete it right away, or, if that
            attempt fails, our daily cleanup deletes it once it is more than a day old.
          </li>
          <li>
            You leave without finishing: once it is more than a day old, our daily cleanup
            deletes it.
          </li>
        </LegalList>
      </LegalSection>

      {/* Guardian consent ended 2026-11-16: the API refuses every guardian endpoint
          (guardian-consent-policy.ts) and migration 20261116120000_guardian_consent_off made
          waiting accounts active. The GuardianConsent and invitation rows are kept. */}
      <LegalSection title="Earlier guardian consent records">
        <p>
          Until 16 November 2026, accounts for ages 13 to 15 needed a guardian&apos;s
          approval. CoutureCast no longer asks for it, and those accounts now work like
          any other. We keep the guardian records made before then: the guardian email
          address, the consent level, and the time and IP address of each approval or
          revocation. A guardian or teen can ask us to delete them by writing to the
          address below.
        </p>
      </LegalSection>

      {/* Web: apps/web/src/analytics/browser-analytics.ts through the /ingest proxy, with
          PostHog's random anonymous id. Mobile: apps/mobile/src/config/posthog.ts, direct to
          PostHog, the same. Server: telemetry.service.ts sends some events with a keyed hash
          of the account id and others (profile_completed among them) with the account id
          itself; profile_completed carries age and guardian_consent_required. */}
      <LegalSection title="Analytics">
        <p>
          We use PostHog to count page views, a fixed list of product events, and errors.
          The website sends them through our own servers; the mobile app sends them to
          PostHog directly. Events from the website and the app carry a random identifier
          PostHog gives the browser or device. Events our servers send identify your
          account by its internal account id (a random id, not your name or email address)
          or by a keyed hash of that id. No event carries your email address or a sign-in
          code. The event recorded when you finish signup also carries your age at signup
          and whether guardian consent is required. Session recording, heatmaps, and
          automatic click capture are off.
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
          {/* WEATHER_PROVIDER_MODE picks OpenWeather or WeatherAPI for forecasts and place search.
              Use my location: the client and the API round the position to two decimals
              (apps/web/src/lib/device-position.ts, location-capture.service.ts) and the save
              stores only the provider's place. */}
          <li>
            OpenWeather: forecasts and place search. It receives the place or city you
            enter and the coordinates of the places you get forecasts for. When you tap
            Use my location, the weather provider in use (OpenWeather, or WeatherAPI when
            that provider is in use) receives your approximate position, rounded to about
            1 km, to find the city near you. CoutureCast stores only the place you pick.
          </li>
          <li>
            WeatherAPI: the same forecasts and place search, with the same information,
            when CoutureCast uses it in place of OpenWeather.
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
          <Link href="/terms" className={LEGAL_INLINE_LINK_CLASS}>
            Terms of Service
          </Link>{' '}
          cover the rules for using CoutureCast.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
