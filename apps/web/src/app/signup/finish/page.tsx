import { parsePreviewFrom, parseSignInDoor } from '@couture/utils'
import { FinishSignupForm } from './finish-signup-form'

export default async function FinishSignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { from, door } = await searchParams
  return (
    <main
      id="main-content"
      tabIndex={-1}
      data-focus-surface="dark"
      className="min-h-screen bg-gradient-to-b from-neutral-950 via-black to-neutral-900 px-6 py-16 text-white outline-none"
    >
      <div className="mx-auto w-full max-w-lg">
        <FinishSignupForm
          fromPreview={parsePreviewFrom(from) !== null}
          door={parseSignInDoor(typeof door === 'string' ? door : null)}
        />
      </div>
    </main>
  )
}
