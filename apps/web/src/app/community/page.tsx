// Production follow-up 2026-11-19 owner: the bottom-nav Community destination in
// `apps/web/src/app/community/page.tsx`. It was the Story 3.6 placeholder (a dark page holding
// only the word "Community"), so a phone reader who tapped Community met an empty screen while
// the real lookbook lived only on Home. It now renders that lookbook: spotlight, the Latest looks
// heading with its climate explainer and chips, and the feed.
// Story CC-7.9 D7: on the one page surface, with no dark frame and no inset lookbook card.
'use client'

import React from 'react'
import { AppPage, APP_MAIN_NARROW_CLASS } from '../components/app-page'
import { AppTopBar } from '../components/app-top-bar'
import { CommunityLookbookGrid } from '../components/community-lookbook-grid'
import { ScreenGate } from '../components/screen-gate'
import { StickyBottomNav } from '../components/sticky-bottom-nav'

export default function CommunityPage() {
  return (
    <AppPage className="overflow-x-clip">
      <AppTopBar titleKey="nav.community" />
      <main
        id="main-content"
        tabIndex={-1}
        data-testid="community-page"
        className={APP_MAIN_NARROW_CLASS}
      >
        {/* Story CC-7.7 D3: the lookbook appears once its first feed page and the City Spotlight
            above it have answered, so neither moves the other when it lands. */}
        <ScreenGate
          screen="community"
          reads={COMMUNITY_GATE_READS}
          placeholderClassName="min-h-[60vh] w-full rounded-xl bg-card-muted"
        >
          <CommunityLookbookGrid
            showFilterNav
            filterNavStickyTop={0}
            returnPath="/community"
            newPostEmphasis="primary"
          />
        </ScreenGate>
      </main>
      <StickyBottomNav />
    </AppPage>
  )
}

const COMMUNITY_GATE_READS = ['feed', 'spotlight'] as const
