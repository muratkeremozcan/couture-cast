import Link from 'next/link'

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-focus-surface="dark"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black text-white outline-none"
    >
      <h1 className="text-3xl font-semibold">404: Page Not Found</h1>
      <p className="text-base opacity-75">
        The page you were looking for doesn&apos;t exist. Head back to the home screen to
        continue.
      </p>
      <Link href="/" className="rounded border border-white px-4 py-2 text-sm uppercase">
        Go home
      </Link>
    </main>
  )
}
