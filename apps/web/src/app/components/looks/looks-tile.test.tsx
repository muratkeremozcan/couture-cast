// Learning path Step 69: Looks tab for saved looks, ideas and plans.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-69-looks-tab-for-saved-looks-ideas-and-plans
// Story CC-7.12 test owner (TEA): 7.12-UNIT-030 (state line order and plurals), 7.12-UNIT-031
// (collage: first four pieces, catalog art, dashed placeholder, image error swap; Codex 7.12 #7 a
// refreshed URL gets a fresh try), 7.12-UNIT-032 (one link named "name, line", images alt="")
// and 7.12-UNIT-033 (the saved date in the locale's short month and day).
// Test design: _bmad-output/test-artifacts/test-design-7-12-looks-tab-saved-looks-ideas-plans.md
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  OutfitCapsuleContract,
  SavedLookContract,
} from '@couture/api-client/contracts/http'
import { SAMPLE_CATALOG, looksIdeas } from '@couture/utils'
import { getI18n } from '../../../i18n'
import { CapsuleTile, IdeaTile, SavedLookTile } from './looks-tile'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/looks',
}))

const LIVE = '2099-01-01T00:00:00.000Z'
const CATALOG_IDS = SAMPLE_CATALOG.garments.slice(0, 3).map((garment) => garment.id)

type Slot = SavedLookContract['composition'][number]

function photoSlot(slotIndex: number, url: string, expiresAt = LIVE): Slot {
  return {
    slotIndex,
    category: 'top',
    kind: 'garment',
    itemId: `garment-${slotIndex}`,
    label: null,
    missing: false,
    imageAccess: { url, expiresAt },
  }
}

function catalogSlot(slotIndex: number, itemId: string): Slot {
  return {
    slotIndex,
    category: 'bottom',
    kind: 'catalog',
    itemId,
    label: null,
    missing: false,
    imageAccess: null,
  }
}

function missingSlot(slotIndex: number): Slot {
  return {
    slotIndex,
    category: 'shoes',
    kind: 'garment',
    itemId: `gone-${slotIndex}`,
    label: null,
    missing: true,
    imageAccess: null,
  }
}

function look(overrides: Partial<SavedLookContract> = {}): SavedLookContract {
  return {
    id: 'sl-1',
    ownerUserId: 'member-1',
    source: 'home_sample',
    lookId: SAMPLE_CATALOG.looks[0]!.id,
    weather: 'warm-rainy',
    title: 'Rainy commute',
    anchorGarmentId: null,
    anchorSnapshot: null,
    composition: [],
    swaps: {},
    collection: null,
    comfort: null,
    availabilityStatus: 'ready',
    missingGarmentIds: [],
    needsReviewReasons: [],
    revision: 0,
    createdAt: '2026-11-22T12:00:00.000Z',
    updatedAt: '2026-11-22T12:00:00.000Z',
    ...overrides,
  }
}

function capsule(overrides: Partial<OutfitCapsuleContract> = {}): OutfitCapsuleContract {
  return {
    id: 'cap-1',
    ownerUserId: 'member-1',
    name: 'Weekday capsule',
    description: null,
    occasions: ['work'],
    isFavorite: false,
    revision: 1,
    availabilityStatus: 'ready',
    unavailableGarmentCount: 0,
    garments: [],
    createdAt: '2026-11-03T12:00:00.000Z',
    updatedAt: '2026-11-03T12:00:00.000Z',
    ...overrides,
  } as unknown as OutfitCapsuleContract
}

function renderTile(node: ReactNode) {
  return render(<I18nextProvider i18n={getI18n()}>{node}</I18nextProvider>)
}

afterEach(async () => {
  await getI18n().changeLanguage('en-US')
})

describe('7.12 Looks tile state line (D2)', () => {
  it.each([
    [
      'one missing piece',
      { availabilityStatus: 'missing_garment', missingGarmentIds: ['g-1'] },
      '1 piece missing',
    ],
    [
      'three missing pieces',
      { availabilityStatus: 'missing_garment', missingGarmentIds: ['g-1', 'g-2', 'g-3'] },
      '3 pieces missing',
    ],
    [
      'a missing status with no ids',
      { availabilityStatus: 'missing_garment', missingGarmentIds: [] },
      '1 piece missing',
    ],
    [
      'missing pieces on a look that also needs review',
      { availabilityStatus: 'needs_review', missingGarmentIds: ['g-1', 'g-2'] },
      '2 pieces missing',
    ],
    ['a look that needs review', { availabilityStatus: 'needs_review' }, 'Needs review'],
    ['a ready look', {}, 'Saved Nov 22'],
  ] as const)('7.12-UNIT-030 %s reads "%s"', (_label, overrides, line) => {
    renderTile(
      <SavedLookTile
        look={look(overrides as Partial<SavedLookContract>)}
        href="/looks/saved/sl-1?from=all"
      />
    )

    const tile = screen.getByTestId('saved-look-card-sl-1')
    expect(tile).toHaveAccessibleName(`Rainy commute, ${line}`)
    expect(tile).toHaveTextContent(line)
  })

  it.each([
    ['a ready capsule', {}, 'Saved Nov 3'],
    ['one unavailable piece', { unavailableGarmentCount: 1 }, '1 piece missing'],
    [
      'a capsule that needs repair',
      { availabilityStatus: 'needs_repair', unavailableGarmentCount: 4 },
      '4 pieces missing',
    ],
    [
      'a repair status with no count',
      { availabilityStatus: 'needs_repair', unavailableGarmentCount: 0 },
      '1 piece missing',
    ],
  ] as const)('7.12-UNIT-030 capsule: %s reads "%s"', (_label, overrides, line) => {
    renderTile(
      <CapsuleTile
        capsule={capsule(overrides as Partial<OutfitCapsuleContract>)}
        href="/looks/capsules?capsule=cap-1"
      />
    )

    expect(screen.getByTestId('looks-capsule-card-cap-1')).toHaveAccessibleName(
      `Weekday capsule, ${line}`
    )
  })

  it('7.12-UNIT-033 the saved date uses the locale short month and day', async () => {
    await getI18n().changeLanguage('de-DE')
    renderTile(<SavedLookTile look={look()} href="/looks/saved/sl-1?from=all" />)

    const date = new Intl.DateTimeFormat('de-DE', {
      month: 'short',
      day: 'numeric',
    }).format(new Date('2026-11-22T12:00:00.000Z'))
    expect(date).toBe('22. Nov.')
    expect(screen.getByTestId('saved-look-card-sl-1')).toHaveTextContent(
      `Gespeichert am ${date}`
    )
    expect(screen.getByTestId('saved-look-card-sl-1')).not.toHaveTextContent('Saved')
  })

  it('7.12-UNIT-033 an untitled look is named after its sample look', () => {
    renderTile(
      <SavedLookTile look={look({ title: null })} href="/looks/saved/sl-1?from=all" />
    )
    const name = screen.getByTestId('saved-look-card-sl-1').getAttribute('aria-label')
    expect(name).toMatch(/, Saved Nov 22$/)
    expect(name).not.toMatch(/^(null|sample:|, )/)
  })
})

describe('7.12 Looks tile collage and link (D2, P8)', () => {
  it('7.12-UNIT-031 shows the first four pieces in slot order: photo, catalog art, dashed placeholder', () => {
    renderTile(
      <SavedLookTile
        look={look({
          composition: [
            missingSlot(2),
            photoSlot(0, 'https://photos.example.test/top.png'),
            catalogSlot(1, CATALOG_IDS[0]!),
            catalogSlot(3, CATALOG_IDS[1]!),
            photoSlot(4, 'https://photos.example.test/fifth.png'),
          ],
        })}
        href="/looks/saved/sl-1?from=all"
      />
    )

    const tile = screen.getByTestId('saved-look-card-sl-1')
    const images = tile.querySelectorAll('img')
    expect([...images].map((img) => img.getAttribute('src'))).toEqual([
      'https://photos.example.test/top.png',
    ])
    expect(within(tile).getAllByTestId('looks-tile-placeholder')).toHaveLength(1)
    // Two catalog cells draw sample art (svg), and the fifth piece is left out.
    expect(tile.querySelector('img[src$="fifth.png"]')).toBeNull()
    const collage = tile.querySelector('[aria-hidden="true"]')!
    expect(collage.children).toHaveLength(4)
    expect(collage.children[2]).toContainElement(
      within(tile).getByTestId('looks-tile-placeholder')
    )
  })

  it('7.12-UNIT-031 an expired signed URL draws the placeholder, not the photo', () => {
    renderTile(
      <SavedLookTile
        look={look({
          composition: [
            photoSlot(
              0,
              'https://photos.example.test/old.png',
              '2020-01-01T00:00:00.000Z'
            ),
          ],
        })}
        href="/looks/saved/sl-1?from=all"
      />
    )

    const tile = screen.getByTestId('saved-look-card-sl-1')
    expect(tile.querySelector('img')).toBeNull()
    expect(within(tile).getByTestId('looks-tile-placeholder')).toBeInTheDocument()
  })

  it.each([
    [1, 'grid-cols-1 grid-rows-1', []],
    [2, 'grid-cols-2 grid-rows-1', []],
    [3, 'grid-cols-2 grid-rows-2', [0]],
    [4, 'grid-cols-2 grid-rows-2', []],
    [6, 'grid-cols-2 grid-rows-2', []],
  ] as const)(
    '7.12-UNIT-031 %i pieces fill the square with no empty cells (builder collage review)',
    (pieces, layout, spanning) => {
      const catalogIds = [
        'sample:g:oxford-shirt',
        'sample:g:dark-jeans',
        'sample:g:loafers',
        'sample:g:wool-overcoat',
        'sample:g:fleece-zip',
        'sample:g:puffer-jacket',
      ]
      renderTile(
        <SavedLookTile
          look={look({
            composition: catalogIds.slice(0, pieces).map((itemId, slotIndex) => ({
              slotIndex,
              category: 'top' as const,
              kind: 'catalog' as const,
              itemId,
              label: null,
              missing: false,
              imageAccess: null,
            })),
          })}
          href="/looks/saved/sl-1?from=all"
        />
      )
      const collage = screen
        .getByTestId('saved-look-card-sl-1')
        .querySelector('[aria-hidden="true"]')!
      expect(collage.children).toHaveLength(Math.min(pieces, 4))
      expect(collage).toHaveClass(...layout.split(' '))
      Array.from(collage.children).forEach((cell, index) => {
        // Three pieces: the first spans the left column beside a stacked pair.
        if ((spanning as readonly number[]).includes(index))
          expect(cell).toHaveClass('row-span-2')
        else expect(cell).not.toHaveClass('row-span-2')
      })
    }
  )

  it('7.12-UNIT-031 a photo that fails swaps to the placeholder in the same cell, and a refreshed URL is tried again (Codex 7.12 #7)', () => {
    const href = '/looks/saved/sl-1?from=all'
    const first = look({
      composition: [photoSlot(0, 'https://photos.example.test/a.png')],
    })
    const view = renderTile(<SavedLookTile look={first} href={href} />)
    const tile = screen.getByTestId('saved-look-card-sl-1')
    const collage = tile.querySelector('[aria-hidden="true"]')!
    const cell = collage.children[0]!
    const img = cell.querySelector('img')!

    fireEvent.error(img)

    expect(tile.querySelector('img')).toBeNull()
    expect(collage.children[0]).toHaveAttribute('data-testid', 'looks-tile-placeholder')
    // One piece fills the square (no filler cells); the placeholder takes the photo cell's place.
    expect(collage.children).toHaveLength(1)
    expect(collage).toHaveClass('aspect-square')
    expect(collage.children[0]).toHaveClass('h-full', 'w-full')

    // The feed hands the same piece a fresh signed URL while the tile stays mounted.
    view.rerender(
      <I18nextProvider i18n={getI18n()}>
        <SavedLookTile
          look={look({
            composition: [photoSlot(0, 'https://photos.example.test/b.png')],
          })}
          href={href}
        />
      </I18nextProvider>
    )
    expect(tile.querySelector('img')).toHaveAttribute(
      'src',
      'https://photos.example.test/b.png'
    )
    expect(within(tile).queryByTestId('looks-tile-placeholder')).toBeNull()

    // The URL that failed stays failed if it comes back.
    view.rerender(
      <I18nextProvider i18n={getI18n()}>
        <SavedLookTile look={first} href={href} />
      </I18nextProvider>
    )
    expect(tile.querySelector('img')).toBeNull()
  })

  it('7.12-UNIT-032 the tile is one link named "name, line" whose images are decorative', () => {
    renderTile(
      <SavedLookTile
        look={look({
          composition: [
            photoSlot(0, 'https://photos.example.test/a.png'),
            photoSlot(1, 'https://photos.example.test/b.png'),
          ],
        })}
        href="/looks/saved/sl-1?from=today"
      />
    )

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    const tile = links[0]!
    expect(tile).toBe(screen.getByTestId('saved-look-card-sl-1'))
    expect(tile).toHaveAttribute('href', '/looks/saved/sl-1?from=today')
    expect(tile).toHaveAccessibleName('Rainy commute, Saved Nov 22')
    expect(tile).toHaveClass('min-h-touch')
    for (const img of tile.querySelectorAll('img')) expect(img).toHaveAttribute('alt', '')
    expect(screen.queryAllByRole('img')).toEqual([])
    expect(within(tile).queryAllByRole('button')).toEqual([])
  })

  it('7.12-UNIT-032 a capsule tile is one link to the manager on its card', () => {
    renderTile(
      <CapsuleTile
        capsule={capsule({
          garments: [
            {
              id: 'g-2',
              category: 'bottom',
              material: 'denim',
              comfortRange: 'mild',
              imageAccess: { url: 'https://photos.example.test/g2.png', expiresAt: LIVE },
              availabilityStatus: 'ready',
              garmentOrder: 1,
            },
            {
              id: 'g-1',
              category: 'top',
              material: 'cotton',
              comfortRange: 'mild',
              imageAccess: { url: 'https://photos.example.test/g1.png', expiresAt: LIVE },
              availabilityStatus: 'ready',
              garmentOrder: 0,
            },
            {
              id: 'g-3',
              category: 'shoes',
              material: 'leather',
              comfortRange: 'mild',
              imageAccess: null,
              availabilityStatus: 'unavailable',
              garmentOrder: 2,
            },
          ],
        } as unknown as Partial<OutfitCapsuleContract>)}
        href="/looks/capsules?capsule=cap-1"
      />
    )

    const tile = screen.getByRole('link')
    expect(tile).toHaveAttribute('href', '/looks/capsules?capsule=cap-1')
    expect(
      [...tile.querySelectorAll('img')].map((img) => img.getAttribute('src'))
    ).toEqual([
      'https://photos.example.test/g1.png',
      'https://photos.example.test/g2.png',
    ])
    expect(within(tile).getAllByTestId('looks-tile-placeholder')).toHaveLength(1)
  })

  it('7.12-UNIT-031 an Ideas tile is a picture from catalog art with no control', () => {
    const idea = looksIdeas()[0]!
    renderTile(<IdeaTile idea={idea} />)

    const tile = screen.getByTestId(`looks-idea-card-${idea.look.id}`)
    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(tile.querySelectorAll('img')).toHaveLength(0)
    expect(within(tile).queryByTestId('looks-tile-placeholder')).toBeNull()
    expect(tile.textContent?.trim().length).toBeGreaterThan(0)
  })
})
