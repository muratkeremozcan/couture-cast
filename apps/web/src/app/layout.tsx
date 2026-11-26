import { SessionBridge } from './components/session-bridge'
// Step 2 step 2 owner: searchable owner anchor
import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { SkipToContent } from './components/skip-to-content'
import { SaveFeedbackProvider } from './components/save-feedback'
import { blockedStorageFallbackScript } from '../lib/browser-persistence'
import { landingSessionScript } from '../lib/landing-session'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: 'CoutureCast',
  description: 'Weather Intelligence & Outfit Personalization',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // The head script sets data-session before React hydrates, so <html> differs from the server
    // render by that one attribute on purpose.
    <html
      lang="en"
      suppressHydrationWarning
      // Story CC-7.9 D4: Geist Sans on every page, from the root.
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        {/* First: a browser that refuses storage gets an in-memory store before any SDK loads. */}
        <script dangerouslySetInnerHTML={{ __html: blockedStorageFallbackScript() }} />
        <script
          // Static source with no user input (lib/landing-session.ts): it must run before first
          // paint, so it cannot wait for a bundle.
          dangerouslySetInnerHTML={{
            __html: landingSessionScript({
              e2eAuth: process.env.NEXT_PUBLIC_E2E_AUTH === 'true',
            }),
          }}
        />
      </head>
      <body className="bg-page font-sans text-ink antialiased">
        <SkipToContent />
        <SaveFeedbackProvider>{children}</SaveFeedbackProvider>
        {/* Last, so its effect switches to the browser language after every component in the page
            has subscribed to the change; placed first, the switch fired before they listened and
            the sign-in doors stayed English (TEA sign-off N-1). */}
        <SessionBridge />
      </body>
    </html>
  )
}
