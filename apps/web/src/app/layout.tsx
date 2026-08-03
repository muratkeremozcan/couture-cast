// Step 2 step 2 owner: searchable owner anchor
import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { SkipToContent } from './components/skip-to-content'

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
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SkipToContent />
        {children}
      </body>
    </html>
  )
}
