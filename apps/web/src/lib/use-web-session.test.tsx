// Learning path Step 58: Production follow-ups after the project close.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#production-follow-ups-after-the-project-close
// Production follow-up (2026-11-19), owner on production 8b0fed06: Shopping and partners, Premium
// and Interface palettes each asked once, on mount, whether the tab held the verified bearer, and
// told a signed-in member to sign in. They now share one primitive, `MemberScope`: it renders
// member-owned UI keyed by the live owner and hands it the session in one shape. These cases pin
// that shape and the keying; each section's own transitions live in its *-session.test.tsx.
import { useLayoutEffect, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEB_ACCESS_TOKEN_STORAGE_KEY } from './wardrobe'
import type * as WebSession from './web-session'
import {
  isLiveOwner,
  isSessionRecheckError,
  MemberScope,
  memberSessionOf,
  readAsMember,
  SessionRecheckError,
  type MemberSession,
  useMountSignal,
  useSessionRecheck,
} from './use-web-session'

/** The session bridge's state, driven by hand: who verification named, and each pending check. */
const session = vi.hoisted(() => ({
  identity: null as string | null,
  stored: false,
  pending: [] as {
    resolve: (token: string | undefined) => void
    reject: (error: Error) => void
  }[],
}))

vi.mock('./web-session', async (importOriginal) => ({
  ...(await importOriginal<typeof WebSession>()),
  webSessionIdentity: () => session.identity,
  hasStoredWebSession: () => session.stored,
  resolveWebSessionToken: () =>
    new Promise<string | undefined>((resolve, reject) => {
      session.pending.push({ resolve, reject })
    }),
}))

/** What the bridge does when verification names (or clears) the member. */
function publish(identity: string | null, bearer: string | null) {
  act(() => {
    session.identity = identity
    if (bearer === null) window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    else window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, bearer)
    window.dispatchEvent(new Event('couture:session'))
  })
}

let mounts: number

/** A member-owned probe: its state lives only as long as its owner's scope. */
function Probe({ session: current }: { session: MemberSession }) {
  const [mountId] = useState(() => ++mounts)
  const [notes, setNotes] = useState(0)
  return (
    <div>
      <p data-testid="status">{current.status}</p>
      <p data-testid="owner">{current.owner ?? 'none'}</p>
      <p data-testid="mount">{mountId}</p>
      <p data-testid="notes">{notes}</p>
      <button type="button" onClick={() => setNotes((count) => count + 1)}>
        note
      </button>
      <button type="button" onClick={current.retry}>
        retry
      </button>
    </div>
  )
}

function renderScope() {
  return render(<MemberScope>{(current) => <Probe session={current} />}</MemberScope>)
}

const text = (id: string) => screen.getByTestId(id).textContent

describe('MemberScope: the session as every member-owned section reads it', () => {
  beforeEach(() => {
    mounts = 0
    session.identity = null
    session.stored = false
    session.pending = []
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('MEMBER-SCOPE-01 a stored session reads checking until verification names the member', () => {
    session.stored = true
    renderScope()
    expect(text('status')).toBe('checking')
    expect(text('owner')).toBe('none')
    expect(session.pending).toHaveLength(1)

    publish('member-1', 'token-1')
    expect(text('status')).toBe('signed_in')
    expect(text('owner')).toBe('member-1')
  })

  it('MEMBER-SCOPE-02 no stored session reads signed out, and asks nothing', () => {
    renderScope()
    expect(text('status')).toBe('signed_out')
    expect(text('owner')).toBe('none')
    expect(session.pending).toHaveLength(0)
  })

  it('MEMBER-SCOPE-03 a failed check is an outage whose retry verifies again', async () => {
    session.stored = true
    renderScope()
    await act(async () => {
      session.pending[0]!.reject(new Error('Session verification is unavailable.'))
      await Promise.resolve()
    })
    expect(text('status')).toBe('unavailable')

    await userEvent.setup().click(screen.getByRole('button', { name: 'retry' }))
    expect(session.pending).toHaveLength(2)
    expect(text('status')).toBe('checking')

    publish('member-1', 'token-1')
    expect(text('status')).toBe('signed_in')
  })

  it('MEMBER-SCOPE-04 the same member named again keeps the scope; a new member starts a fresh one', async () => {
    session.stored = true
    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    renderScope()
    expect(text('owner')).toBe('member-1')
    const first = text('mount')
    await userEvent.setup().click(screen.getByRole('button', { name: 'note' }))
    expect(text('notes')).toBe('1')

    // A token refresh: the bridge announces the same member again.
    publish('member-1', 'token-1b')
    expect(text('mount')).toBe(first)
    expect(text('notes')).toBe('1')

    // An account switch clears the member, then names the next one.
    publish(null, null)
    expect(text('mount')).not.toBe(first)
    expect(text('notes')).toBe('0')
    expect(text('owner')).toBe('none')
    publish('member-2', 'token-2')
    expect(text('owner')).toBe('member-2')
    expect(text('notes')).toBe('0')
  })
})

describe('memberSessionOf and isLiveOwner', () => {
  afterEach(() => {
    session.identity = null
    window.sessionStorage.clear()
  })

  it('MEMBER-SCOPE-05 names an owner only when signed in, and a retry only when unavailable', () => {
    const retry = vi.fn()
    expect(memberSessionOf({ status: 'signed_in', owner: 'member-1' })).toMatchObject({
      status: 'signed_in',
      owner: 'member-1',
    })
    expect(memberSessionOf({ status: 'checking' }).owner).toBeNull()
    expect(memberSessionOf({ status: 'signed_out' }).owner).toBeNull()

    memberSessionOf({ status: 'unavailable', retry }).retry()
    expect(retry).toHaveBeenCalledTimes(1)
    // Elsewhere the retry does nothing, so a stale control cannot start a verification.
    memberSessionOf({ status: 'signed_out' }).retry()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('MEMBER-SCOPE-06 a late answer is live only while the bridge still names its owner', () => {
    expect(isLiveOwner(null)).toBe(false)
    expect(isLiveOwner('member-1')).toBe(false)

    session.identity = 'member-1'
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1')
    expect(isLiveOwner('member-1')).toBe(true)
    expect(isLiveOwner('member-2')).toBe(false)

    // The bridge removed the bearer while it verifies again: nobody is live.
    window.sessionStorage.removeItem(WEB_ACCESS_TOKEN_STORAGE_KEY)
    expect(isLiveOwner('member-1')).toBe(false)
  })
})

// Settings Codex review 2, finding 4: a billing redirect or sponsored navigation checks the mount
// signal last. It has to be dead in the very commit that removes the component, before any
// passive cleanup that a concurrent route transition could defer.
describe('useMountSignal', () => {
  it('MEMBER-SCOPE-07 the signal is aborted in the commit that unmounts its component', () => {
    let captured: AbortSignal | null = null
    let seenByNextScreen: boolean | null = null

    function Leaving() {
      const signal = useMountSignal()
      useLayoutEffect(() => {
        captured = signal()
      }, [signal])
      return <p>leaving</p>
    }

    /** Mounted in the same commit; its layout effect runs before any passive cleanup. */
    function Arriving() {
      useLayoutEffect(() => {
        seenByNextScreen = captured?.aborted ?? null
      }, [])
      return <p>arriving</p>
    }

    const view = render(<Leaving />)
    expect(captured).not.toBeNull()
    expect((captured as AbortSignal | null)?.aborted).toBe(false)

    view.rerender(<Arriving />)
    expect(seenByNextScreen).toBe(true)
  })
})

// PR #259 review round 2 (CodeRabbit): recovery after a failed recheck.
describe('recovery after a failed recheck', () => {
  const denial = Object.assign(new Error('denied'), { denied: true })
  const isDenial = (error: unknown) => (error as { denied?: boolean }).denied === true

  beforeEach(() => {
    session.identity = 'member-1'
    session.stored = true
    session.pending = []
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1a')
  })

  afterEach(() => {
    session.identity = null
    session.stored = false
    window.sessionStorage.clear()
  })

  it('MEMBER-SCOPE-08 a publication that lands before recovery is armed still reads again, once', () => {
    let markFailed!: (error: SessionRecheckError) => void
    function Section() {
      const recheck = useSessionRecheck('member-1')
      markFailed = recheck.markFailed
      return <p data-testid="attempt">{recheck.attempt}</p>
    }
    render(<Section />)

    // The recheck fails, then the bridge verifies member-1 before the section arms recovery.
    const failure = new SessionRecheckError(denial)
    act(() => {
      window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1b')
      window.dispatchEvent(new Event('couture:session'))
    })
    act(() => markFailed(failure))

    expect(screen.getByTestId('attempt')).toHaveTextContent('1')
    // A later publication for the same member, with nothing waiting, reads nothing more.
    act(() => {
      window.dispatchEvent(new Event('couture:session'))
    })
    expect(screen.getByTestId('attempt')).toHaveTextContent('1')
  })

  it('MEMBER-SCOPE-09 a joined verification superseded by a newer bearer for the same member reads once with it', async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(denial)
      .mockResolvedValueOnce('answer-for-token-1c')

    const result = readAsMember('member-1', read, isDenial)
    await vi.waitFor(() => expect(session.pending).toHaveLength(1))

    // The bridge verified and installed token-1c; the token-1b verification it joined is dropped.
    window.sessionStorage.setItem(WEB_ACCESS_TOKEN_STORAGE_KEY, 'token-1c')
    session.pending[0]!.reject(new Error('Session verification is unavailable.'))

    await expect(result).resolves.toBe('answer-for-token-1c')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('MEMBER-SCOPE-10 control: a failed recheck with the bearer unchanged is an outage, not a retry', async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(denial)

    const result = readAsMember('member-1', read, isDenial)
    await vi.waitFor(() => expect(session.pending).toHaveLength(1))
    session.pending[0]!.reject(new Error('Session verification is unavailable.'))

    const error = await result.catch((caught: unknown) => caught)
    expect(isSessionRecheckError(error)).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
  })
})
