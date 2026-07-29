import { StickyBottomNav } from './sticky-bottom-nav'

export function MobileDestinationPage({ title }: { title: string }) {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-16 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] text-white">
      <h1 className="text-4xl font-semibold">{title}</h1>
      <StickyBottomNav />
    </main>
  )
}
