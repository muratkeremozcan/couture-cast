const listeners = new Set<() => void>()

export function onWardrobeChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyWardrobeChanged(): void {
  for (const listener of [...listeners]) listener()
}
