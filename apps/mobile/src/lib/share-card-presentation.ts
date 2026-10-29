import type { ShareCardSource } from '@couture/api-client'
import { mobileApplicationUserId, subscribeMobileApplicationUser } from './mobile-auth'
import type { ShareCardHeadingScope } from './share-card-focus'
import { traceShareCardPresentation } from './share-card-presentation-trace'

type Draft = Readonly<{
  serial: number
  source: ShareCardSource
  member: string
  scope: ShareCardHeadingScope
  watermark: boolean
  open: boolean
}>
type Snapshot = Readonly<{ root: object | null; draft: Draft | null }>
let snapshot: Snapshot = { root: null, draft: null }
let serial = 0
const listeners = new Set<() => void>()
let unsubscribeIdentity: (() => void) | undefined
let invoker: { root: object; serial: number; node: () => number | null } | null = null

function publish(next: Snapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
  if (!snapshot.root && !snapshot.draft) {
    unsubscribeIdentity?.()
    unsubscribeIdentity = undefined
  }
}
function watchIdentity() {
  unsubscribeIdentity ??= subscribeMobileApplicationUser(() => {
    if (snapshot.draft && snapshot.draft.member !== mobileApplicationUserId()) {
      invoker = null
      publish({ root: snapshot.root, draft: null })
    }
  })
}
const owns = (root: object, draftSerial?: number) =>
  snapshot.root === root &&
  snapshot.draft?.member === mobileApplicationUserId() &&
  (draftSerial === undefined || snapshot.draft?.serial === draftSerial)

export const shareCardPresentationSnapshot = () => snapshot
export function subscribeShareCardPresentation(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A Fabric root owns callbacks; the small composition draft survives its replacement. */
export function acquireShareCardPresentation(root: object) {
  watchIdentity()
  if (snapshot.root !== root) invoker = null
  const draft =
    snapshot.draft?.member === mobileApplicationUserId() ? snapshot.draft : null
  publish({ root, draft })
  return () => {
    if (snapshot.root !== root) return
    invoker = null
    publish({ root: null, draft: snapshot.draft })
  }
}
export function openShareCardPresentation(
  root: object,
  source: ShareCardSource,
  scope: ShareCardHeadingScope,
  node?: () => number | null
): 'opened' | 'root_mismatch' | 'signed_out' {
  const member = mobileApplicationUserId()
  if (!member) {
    traceShareCardPresentation('drop:signed-out')
    return 'signed_out'
  }
  if (snapshot.root !== root) {
    traceShareCardPresentation('drop:root')
    return 'root_mismatch'
  }
  watchIdentity()
  const previous = snapshot.draft
  const same =
    previous?.member === member &&
    previous.scope === scope &&
    JSON.stringify(previous.source) === JSON.stringify(source)
  const draft: Draft = {
    serial: ++serial,
    source: { ...source },
    member,
    scope,
    watermark: same ? previous.watermark : true,
    open: true,
  }
  invoker =
    snapshot.root && node ? { root: snapshot.root, serial: draft.serial, node } : null
  publish({ root: snapshot.root, draft })
  traceShareCardPresentation('open')
  return 'opened'
}
export function changeShareCardWatermark(
  root: object,
  draftSerial: number,
  next: boolean | ((previous: boolean) => boolean)
) {
  const draft = snapshot.draft
  if (!draft?.open || !owns(root, draftSerial)) return
  publish({
    root,
    draft: {
      ...draft,
      watermark: typeof next === 'function' ? next(draft.watermark) : next,
    },
  })
}
export function closeShareCardPresentation(root: object, draftSerial: number) {
  if (!snapshot.draft || !owns(root, draftSerial)) return
  publish({ root, draft: { ...snapshot.draft, open: false } })
  traceShareCardPresentation('close')
}
/** Actual navigation retires the visit. Root teardown itself retains the draft. */
export function retireShareCardPresentation(root: object) {
  if (snapshot.root !== root) return
  invoker = null
  if (snapshot.draft) traceShareCardPresentation('retire')
  publish({ root, draft: null })
}
export function shareCardPresentationFocus(root: object, draftSerial: number) {
  if (!owns(root, draftSerial)) return { current: false, node: null }
  return {
    current: true,
    node:
      invoker?.root === root && invoker.serial === draftSerial ? invoker.node() : null,
  }
}
