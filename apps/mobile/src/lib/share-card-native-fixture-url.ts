export function isShareCardNativeFixtureUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'couturecast-story68:' &&
      parsed.hostname === '__story68__' &&
      parsed.pathname === '/share-card'
    )
  } catch {
    return false
  }
}
export function isShareCardNativeFixtureBuild(
  development: boolean,
  applicationId: string | null,
  enabled: unknown
): boolean {
  return development && applicationId === 'com.couturecast.story68' && enabled === true
}
