import { StickyBottomNav } from './sticky-bottom-nav'

export function MobileDestinationPage({ title }: { title: string }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-focus-surface="dark"
      className="min-h-screen bg-neutral-950 px-6 py-16 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] text-white outline-none"
    >
      <h1 className="text-4xl font-semibold">{title}</h1>
      <StickyBottomNav />
    </main>
  )
}
