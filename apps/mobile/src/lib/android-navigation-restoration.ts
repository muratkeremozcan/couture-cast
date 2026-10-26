import { mobileApplicationUserId, subscribeMobileApplicationUser } from './mobile-auth'

const paths = [
  '/',
  '/community',
  '/settings',
  '/wardrobe',
  '/two',
  '/locations',
  '/modal',
  '/notification-settings',
  '/palette-advisor',
  '/planner',
  '/wardrobe-capsules',
] as const
export type AndroidRestorablePath = (typeof paths)[number]
type Checkpoint = Readonly<{
  member: string
  path: AndroidRestorablePath
  detailId: string | null
}>
type Restoration = Readonly<{
  serial: number
  path: AndroidRestorablePath
  requested: boolean
}>
type Snapshot = Readonly<{
  root: object | null
  path: AndroidRestorablePath | null
  checkpoint: Checkpoint | null
  restoration: Restoration | null
  intent: AndroidRestorablePath | null
}>
let snapshot: Snapshot = {
  root: null,
  path: null,
  checkpoint: null,
  restoration: null,
  intent: null,
}
let serial = 0
const listeners = new Set<() => void>()
let identityCleanup: (() => void) | undefined
let linkCleanup: (() => void) | undefined
function pathOf(path: string): AndroidRestorablePath | null {
  return paths.find((candidate) => candidate === path) ?? null
}
function publish(next: Snapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
  if (!next.root && !next.checkpoint) {
    identityCleanup?.()
    identityCleanup = undefined
    linkCleanup?.()
    linkCleanup = undefined
  }
}
function checkpoint(path: AndroidRestorablePath | null): Checkpoint | null {
  const member = mobileApplicationUserId()
  return path && member ? { member, path, detailId: null } : null
}
const owns = (root: object) => snapshot.root === root
export const androidNavigationSnapshot = () => snapshot
export function subscribeAndroidNavigation(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
/** The subscription remains installed across the root gap while a checkpoint exists. */
export function acquireAndroidNavigation(
  root: object,
  initialPath: string,
  subscribeLinks?: (invalidate: (url: string) => void) => () => void
) {
  identityCleanup ??= subscribeMobileApplicationUser(() => {
    if (snapshot.checkpoint?.member !== mobileApplicationUserId())
      publish({ ...snapshot, checkpoint: null, restoration: null, intent: null })
  })
  if (subscribeLinks && !linkCleanup)
    linkCleanup = subscribeLinks(externalAndroidNavigation)
  const path = pathOf(initialPath)
  const prior =
    snapshot.checkpoint?.member === mobileApplicationUserId() ? snapshot.checkpoint : null
  const restoration =
    prior && prior.path !== '/' && path === '/' && !snapshot.intent
      ? { serial: ++serial, path: prior.path, requested: false }
      : null
  publish({
    root,
    path,
    checkpoint:
      snapshot.intent || restoration || prior?.path === path ? prior : checkpoint(path),
    restoration,
    intent: snapshot.intent,
  })
  return () => {
    if (owns(root)) publish({ ...snapshot, root: null, restoration: null })
  }
}
/** A live root publishes paths; a predecessor can neither retire nor reroute its successor. */
export function observeAndroidPath(
  root: object,
  incoming: string
): 'restored' | 'navigated' | 'unchanged' | 'waiting' {
  if (!owns(root)) return 'unchanged'
  const path = pathOf(incoming)
  const restore = snapshot.restoration
  if (restore && path === restore.path) {
    publish({ ...snapshot, path, restoration: null })
    return 'restored'
  }
  if (restore && path === '/') return 'waiting'
  if (snapshot.intent && path === snapshot.path && path !== snapshot.intent)
    return 'waiting'
  const changed = path !== snapshot.path
  const sameOwner = snapshot.checkpoint?.member === mobileApplicationUserId()
  if (changed || !sameOwner || snapshot.intent) {
    publish({
      ...snapshot,
      path,
      checkpoint: checkpoint(path),
      restoration: null,
      intent: null,
    })
  }
  return changed ? 'navigated' : 'unchanged'
}
export function claimAndroidRestoration(
  root: object,
  ready: boolean
): Restoration | null {
  const restore = snapshot.restoration
  if (
    !owns(root) ||
    !ready ||
    !restore ||
    restore.requested ||
    snapshot.checkpoint?.member !== mobileApplicationUserId()
  )
    return null
  const claimed = { ...restore, requested: true }
  publish({ ...snapshot, restoration: claimed })
  return claimed
}
export function isCurrentAndroidRestoration(root: object, serial: number) {
  return (
    owns(root) &&
    snapshot.restoration?.serial === serial &&
    snapshot.checkpoint?.member === mobileApplicationUserId()
  )
}
export function androidNavigationIntent(root: object, target: string) {
  if (!owns(root)) return
  const path = pathOf(target)
  publish({ ...snapshot, checkpoint: checkpoint(path), restoration: null, intent: path })
}
/** Only static paths survive. URL/query/fragment data never enters the checkpoint. */
export function externalAndroidNavigation(url: string) {
  let target: AndroidRestorablePath | null = null
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\/--(?=\/)/, '')
    target =
      pathOf(`/${parsed.hostname}${path === '/' ? '' : path}`) ?? pathOf(path || '/')
  } catch {
    /* An unrecognized link still supersedes a restoration. */
  }
  publish({
    ...snapshot,
    checkpoint: checkpoint(target),
    restoration: null,
    intent: target,
  })
}
export function setAndroidSpotlightDetail(root: object, postId: string | null) {
  const current = snapshot.checkpoint
  if (
    !owns(root) ||
    !current ||
    current.member !== mobileApplicationUserId() ||
    current.path !== '/community' ||
    snapshot.restoration
  )
    return
  if (current.detailId !== postId)
    publish({ ...snapshot, checkpoint: { ...current, detailId: postId } })
}
export function ownsAndroidNavigation(root: object) {
  return owns(root)
}
