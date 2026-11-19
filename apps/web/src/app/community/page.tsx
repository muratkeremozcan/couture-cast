// Production follow-up 2026-11-19 owner: the bottom-nav Community destination in
// `apps/web/src/app/community/page.tsx`. It was the Story 3.6 placeholder (a dark page holding
// only the word "Community"), so a phone reader who tapped Community met an empty screen while
// the real lookbook lived only on Home. It now renders that lookbook: spotlight, the Latest looks
// heading with its climate explainer and chips, and the feed.
'use client'

import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getI18n } from '../../i18n'
import { CommunityLookbookGrid } from '../components/community-lookbook-grid'
import { StickyBottomNav } from '../components/sticky-bottom-nav'

export default function CommunityPage() {
  const { t } = useTranslation(undefined, { i18n: getI18n() })
  return (
    <div
      data-focus-surface="dark"
      className="min-h-screen overflow-x-clip bg-gradient-to-b from-neutral-950 via-black to-neutral-900 text-white"
    >
      <main
        id="main-content"
        tabIndex={-1}
        data-testid="community-page"
        className="mx-auto max-w-3xl px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] outline-none sm:px-6"
      >
        {/* The bottom nav hides from 768 px, so wider screens get the same brand link Home's
            header shows, or a desktop reader who opened /community has no way back. */}
        <Link
          href="/"
          data-testid="community-page-home-link"
          className="inline-flex min-h-[44px] items-center text-xs uppercase tracking-[0.3em] text-neutral-400 hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
        >
          CoutureCast
        </Link>
        <h1 className="mb-6 text-3xl font-semibold">{t('community.title')}</h1>
        {/* The same light lookbook surface Home's prism container gives the grid. The wrapper
            clips with overflow-x-clip: overflow-x-hidden makes it a scroll container, and the
            sticky filter nav would then stick to it and scroll off the screen. */}
        <div
          data-focus-surface="light"
          className="lookbook-body rounded-[16px] bg-[#FFFFFF] px-4 py-6 text-[#111111] sm:px-6"
        >
          <CommunityLookbookGrid
            showFilterNav
            filterNavStickyTop={0}
            returnPath="/community"
          />
        </div>
      </main>
      <StickyBottomNav />
    </div>
  )
}
