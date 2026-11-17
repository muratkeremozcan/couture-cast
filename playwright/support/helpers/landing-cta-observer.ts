// Owner report 2026-11-16 (iPhone Safari): after Google sign-in the landing still offered
// Start signup and Sign in, so a signed-in teen tapped Sign in again and ran Google again.
// TEA test design: a member must never see a signed-out landing action, not even for one
// frame, and a visitor whose account is not confirmed must never see the member action.
// This init script runs before the document parses and samples every animation frame from
// first paint, so it records what a person could have seen, not only the settled page.
import type { Page } from '@playwright/test'

/** The landing's signed-out actions: Start signup, Try a sample wardrobe and Sign in. */
export const GUEST_LANDING_ACTIONS = [
  'a[href="/signup"][data-ph-cta-label="Start signup"]',
  '[data-testid="guest-preview-entry"]',
  '[data-testid="landing-sign-in"]',
] as const

/** The landing's member actions. */
export const MEMBER_LANDING_ACTIONS = [
  '[data-testid="landing-open-wardrobe"]',
  '[data-testid="landing-sign-out"]',
] as const

export type LandingActionsSeen = { guest: string[]; member: string[]; states: string[] }

declare global {
  interface Window {
    __landingActionsSeen?: LandingActionsSeen
  }
}

/** Starts recording, from first paint, every landing action that was ever visible. */
export async function recordLandingActions(page: Page) {
  await page.addInitScript(
    ({ guest, member }) => {
      const seen: LandingActionsSeen = { guest: [], member: [], states: [] }
      // Every value <html data-session> takes, from the head script's on, in order. The init
      // script runs before <html> exists, so the observer watches the document itself.
      const state = () => {
        const root = document.documentElement
        if (!root) return
        const value = root.getAttribute('data-session') ?? '(unset)'
        if (seen.states[seen.states.length - 1] !== value) seen.states.push(value)
      }
      new MutationObserver(state).observe(document, {
        attributes: true,
        attributeFilter: ['data-session'],
        childList: true,
        subtree: true,
      })
      window.__landingActionsSeen = seen
      const visible = (element: Element) => {
        if (!(element instanceof HTMLElement)) return false
        const box = element.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) return false
        return element.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        })
      }
      const sample = () => {
        state()
        for (const [kind, selectors] of [
          ['guest', guest],
          ['member', member],
        ] as const) {
          for (const selector of selectors) {
            const element = document.querySelector(selector)
            if (element && visible(element) && !seen[kind].includes(selector))
              seen[kind].push(selector)
          }
        }
      }
      const frame = () => {
        sample()
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
      document.addEventListener('DOMContentLoaded', sample)
    },
    { guest: [...GUEST_LANDING_ACTIONS], member: [...MEMBER_LANDING_ACTIONS] }
  )
}

/** What the page recorded since its last load. */
export async function landingActionsSeen(page: Page): Promise<LandingActionsSeen> {
  return page.evaluate(() => {
    // A page without the recorder would read as having seen nothing (CodeRabbit on PR 248).
    const seen = window.__landingActionsSeen
    if (!seen) throw new Error('recordLandingActions was not installed on this page')
    return { guest: [...seen.guest], member: [...seen.member], states: [...seen.states] }
  })
}
