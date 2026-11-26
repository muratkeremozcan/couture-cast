// Story 6.16 D3: draws a first-party sample garment from its shared vector data.
import { resolveSampleArt, SAMPLE_ART_VIEWBOX, type SampleGarment } from '@couture/utils'

export function SampleGarmentArt({
  garment,
  label,
  className = 'h-20 w-20',
}: {
  garment: Pick<SampleGarment, 'art' | 'category'>
  /** Accessible description; omit when adjacent text already names the garment. */
  label?: string
  className?: string
}) {
  const art = resolveSampleArt(garment.art, garment.category)
  return (
    <svg
      viewBox={SAMPLE_ART_VIEWBOX}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid="sample-garment-art"
      data-art-fallback={art.fallback ? 'true' : undefined}
      focusable="false"
    >
      {art.paths.map((path, index) =>
        path.stroke ? (
          <path
            key={index}
            d={path.d}
            fill="none"
            stroke={path.tone === 'primary' ? art.primary : art.secondary}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            key={index}
            d={path.d}
            fill={path.tone === 'primary' ? art.primary : art.secondary}
            // Story CC-7.9 D2: the outline follows `ink`, so a near-white garment keeps its edge
            // in light and a near-black one in dark.
            className="stroke-ink"
            strokeOpacity={0.18}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        )
      )}
    </svg>
  )
}
