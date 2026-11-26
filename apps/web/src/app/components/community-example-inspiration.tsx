import type { ClimateBand, CommunityFeedMode } from '@couture/api-client/contracts/http'
import {
  communitySampleOutfits,
  getGuestPreviewStrings,
  sampleLookText,
} from '@couture/utils'
import { SampleGarmentArt } from './guest-preview/sample-garment-art'

export function CommunityExampleInspiration({
  available,
  loading,
  failed,
  servedMode,
  viewerBand,
  items,
  locale,
}: {
  available: boolean
  loading: boolean
  failed: boolean
  servedMode: CommunityFeedMode | null
  viewerBand: ClimateBand | null
  items: readonly { author: { isSelf: boolean } }[]
  locale: string
}) {
  if (
    !available ||
    loading ||
    failed ||
    !servedMode ||
    items.some((item) => !item.author.isSelf)
  )
    return null
  const band =
    servedMode === 'auto' ? viewerBand : servedMode === 'all' ? null : servedMode
  const strings = getGuestPreviewStrings(locale)
  return (
    <section
      aria-label={strings.styleIdeas.inspiration}
      data-testid="community-example-inspiration"
      className="space-y-3 rounded-lg border border-theme-card-border bg-theme-card-bg p-4 text-theme-card-text"
    >
      <h2 className="text-lg font-semibold">{strings.styleIdeas.inspiration}</h2>
      <p className="text-xs">{strings.styleIdeas.illustrations}</p>
      <ul className="grid gap-3 md:grid-cols-3">
        {communitySampleOutfits(band).map((result) => {
          if (!result.look) return null
          const look = sampleLookText(result.look, strings)
          return (
            <li
              key={result.look.id}
              className="space-y-2 rounded-lg border border-theme-card-border p-3"
            >
              <h3 className="text-sm font-semibold">{look.name}</h3>
              <div aria-hidden="true" className="flex flex-wrap gap-1">
                {result.garments.map((garment) => (
                  <SampleGarmentArt
                    key={garment.id}
                    garment={garment}
                    className="h-11 w-11 rounded-md bg-card-muted"
                  />
                ))}
              </div>
              <p className="text-xs">{look.description}</p>
              <p className="text-xs">
                {strings.preferences.weather} ·{' '}
                {strings.values.weather[result.context.weather]}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
