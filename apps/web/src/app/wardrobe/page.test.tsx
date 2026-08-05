// @vitest-environment jsdom
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GarmentItemContract,
  SuggestGarmentTagsData,
  UpdateGarmentTagsInput,
} from '@couture/api-client/contracts/http'
import type { UploadGarmentImageInput } from '../../lib/wardrobe'

const {
  listGarmentsFromWeb,
  uploadGarmentImageFromWeb,
  suggestGarmentTagsFromWeb,
  updateGarmentTagsFromWeb,
} = vi.hoisted(() => ({
  listGarmentsFromWeb: vi.fn<(signal?: AbortSignal) => Promise<GarmentItemContract[]>>(),
  uploadGarmentImageFromWeb:
    vi.fn<(input: UploadGarmentImageInput) => Promise<GarmentItemContract>>(),
  suggestGarmentTagsFromWeb:
    vi.fn<(garmentId: string, signal?: AbortSignal) => Promise<SuggestGarmentTagsData>>(),
  updateGarmentTagsFromWeb:
    vi.fn<
      (
        garmentId: string,
        tags: UpdateGarmentTagsInput,
        signal?: AbortSignal
      ) => Promise<GarmentItemContract>
    >(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/wardrobe',
}))

vi.mock('../../lib/wardrobe', () => ({
  listGarmentsFromWeb,
  uploadGarmentImageFromWeb,
  suggestGarmentTagsFromWeb,
  updateGarmentTagsFromWeb,
}))

import WardrobePage from './page'

const persistedGarment: GarmentItemContract = {
  id: 'persisted-garment-1',
  status: 'processing',
  category: null,
  material: null,
  comfortRange: null,
  tagsConfirmedAt: null,
  fileSizeBytes: 1024,
  mimeType: 'image/png',
  retentionStatus: 'active',
  createdAt: '2026-08-04T09:25:00.000Z',
  committedAt: '2026-08-04T09:26:22.000Z',
  imageAccess: {
    url: 'https://example.test/garment.png',
    expiresAt: '2026-08-04T09:41:22.000Z',
  },
}

describe('WardrobePage persistence', () => {
  beforeEach(() => {
    listGarmentsFromWeb.mockReset()
    uploadGarmentImageFromWeb.mockReset()
    suggestGarmentTagsFromWeb.mockReset()
    updateGarmentTagsFromWeb.mockReset()
  })

  it('reconciles a committed garment and hydrates it again after reload', async () => {
    const user = userEvent.setup()
    listGarmentsFromWeb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([persistedGarment])
    uploadGarmentImageFromWeb.mockResolvedValue(persistedGarment)

    const firstRender = render(<WardrobePage />)
    await screen.findByText('No garments added yet')
    await user.click(screen.getByRole('button', { name: '+ Add Garment' }))
    await user.upload(
      screen.getByLabelText('Garment image file'),
      new File(['fixture-image'], 'garment.png', { type: 'image/png' })
    )
    await user.click(await screen.findByRole('button', { name: 'Use This Image' }))

    await screen.findByText('Garment Upload Complete!')
    expect(uploadGarmentImageFromWeb).toHaveBeenCalledOnce()
    expect(screen.getByText(persistedGarment.id)).toBeInTheDocument()

    firstRender.unmount()
    render(<WardrobePage />)

    await waitFor(() => expect(listGarmentsFromWeb).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(persistedGarment.id)).toBeInTheDocument()
  })
})
