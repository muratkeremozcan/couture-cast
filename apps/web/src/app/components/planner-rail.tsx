// Story 3.5 Task 1 step 2 owner: implement ultrawide 7-day planning drawer in apps/web/src/app/components/planner-rail.tsx
// Story 5.2 Task 7 owner: entitlement-aware locked state (Decision 2).
'use client'

import { getI18n } from '../../i18n'

export interface PlannerRailProps {
  isOpen: boolean
  onClose: () => void
  /**
   * Resolved by the hosting layout via `lib/premium.ts`. Signed-out and
   * unknown states are locked: an entitlement this component cannot verify is
   * an entitlement it does not have.
   */
  isEntitled: boolean
}

/**
 * The locked state obeys the PRD's "no dark patterns around conversion
 * prompts" guardrail: it says plainly that the planner is Premium-only and
 * links to `/settings`, with no fake urgency and no modal. The `aria-label`
 * and the close affordance are identical in both states, so the a11y suite's
 * landmark contract and the open/close behavior hold regardless of
 * entitlement.
 */
export function PlannerRail({ isOpen, onClose, isEntitled }: PlannerRailProps) {
  if (!isOpen) return null

  // The host page does not mount an I18nextProvider (its own copy is static
  // English), so the locked strings read the shared instance directly.
  const i18n = getI18n()

  return (
    <aside
      aria-label="Planner Rail"
      className="planner-rail-enter flex flex-col gap-6 rounded-[8px] border border-[#E6E6ED] bg-[#F5F5F7] p-6 shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-[#E6E6ED] pb-4">
        <div>
          <h3 className="lookbook-display text-lg font-semibold text-[#111111]">
            7-Day Outfit Planner
          </h3>
          <p className="lookbook-metrics text-xs text-[#5C5C66]">
            Ultrawide Planner Rail
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close planner rail"
          className="rounded-md p-1 text-[#5C5C66] hover:text-[#111111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]"
        >
          ✕
        </button>
      </div>

      {isEntitled ? (
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-[#E6E6ED] bg-[#FFFFFF] p-4">
            <div className="lookbook-metrics flex items-center justify-between text-xs">
              <span className="text-[#8A691F]">TOMORROW</span>
              <span className="text-[#5C5C66]">17°C Rain</span>
            </div>
            <p className="text-sm font-medium text-[#111111]">
              Waterproof Trench + Leather Boots
            </p>
            <p className="text-xs text-[#36363D]">High confidence commute score (98%)</p>
          </div>

          <div className="space-y-2 rounded-lg border border-[#E6E6ED] bg-[#FFFFFF] p-4">
            <div className="lookbook-metrics flex items-center justify-between text-xs">
              <span className="text-[#8A691F]">THURSDAY</span>
              <span className="text-[#5C5C66]">22°C Clear</span>
            </div>
            <p className="text-sm font-medium text-[#111111]">
              Tailored Blazer + Cotton Chinos
            </p>
            <p className="text-xs text-[#36363D]">Ideal for evening outdoor events</p>
          </div>
        </div>
      ) : (
        <div
          className="space-y-3 rounded-lg border border-[#E6E6ED] bg-[#FFFFFF] p-4"
          data-testid="planner-rail-locked"
        >
          <p className="text-sm font-medium text-[#111111]">
            {i18n.t('commerce.premium.plannerLocked.title')}
          </p>
          <a
            href="/settings"
            className="inline-block rounded-lg bg-[#C9A14A] px-4 py-2 text-xs font-semibold text-[#111111] hover:bg-[#b58e3c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111]"
            data-testid="planner-rail-get-premium"
          >
            {i18n.t('commerce.premium.plannerLocked.cta')}
          </a>
        </div>
      )}
    </aside>
  )
}
