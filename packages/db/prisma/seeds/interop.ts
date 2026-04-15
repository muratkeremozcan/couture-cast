export function unwrapCjsNamespace<T>(module: T): T {
  if (typeof module === 'object' && module !== null && 'default' in module) {
    const maybeDefault = (module as { default?: unknown }).default
    if (typeof maybeDefault === 'object' && maybeDefault !== null) {
      return maybeDefault as T
    }
  }

  return module
}
