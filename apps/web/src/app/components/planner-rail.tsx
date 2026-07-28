// Story 3.5 Task 1 step 2 owner: implement ultrawide 7-day planning drawer in apps/web/src/app/components/planner-rail.tsx
'use client'

export interface PlannerRailProps {
  isOpen: boolean
  onClose: () => void
}

export function PlannerRail({ isOpen, onClose }: PlannerRailProps) {
  if (!isOpen) return null

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
    </aside>
  )
}
