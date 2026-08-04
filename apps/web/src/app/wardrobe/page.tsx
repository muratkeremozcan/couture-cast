// Story 4.1 Task 8 step 2 owner: implement web wardrobe hub page
'use client'

import React, { useEffect, useState } from 'react'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import { SkipToContent } from '../components/skip-to-content'
import { GarmentCaptureModal } from '../components/garment-capture-modal'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import { listGarmentsFromWeb } from '../../lib/wardrobe'

export default function WardrobePage() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void listGarmentsFromWeb(controller.signal)
      .then((persistedGarments) => {
        setGarments(persistedGarments)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error ? error.message : 'Unable to load your wardrobe.'
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      })
    return () => controller.abort()
  }, [])

  const handleGarmentCommitted = (garment: GarmentItemContract) => {
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <SkipToContent />

      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Wardrobe Hub
          </h1>
          <button
            onClick={() => setIsModalOpen(true)}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            + Add Garment
          </button>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-5xl px-6 py-8 pb-24 outline-none md:pb-8"
      >
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Your Digital Closet
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Photograph or upload clothing items to power personalized weather guidance.
          </p>

          {loadError && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            >
              {loadError}
            </p>
          )}

          {isLoading ? (
            <p role="status" className="mt-8 text-center text-sm text-zinc-500">
              Loading your wardrobe...
            </p>
          ) : garments.length === 0 ? (
            <div className="mt-8 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
              <div className="text-4xl">🧥</div>
              <h3 className="mt-3 text-base font-semibold text-zinc-800 dark:text-zinc-200">
                No garments added yet
              </h3>
              <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                Snap a photo of your favorite jacket, top, or dress to get started.
              </p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Snap or Import Garment
              </button>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {garments.map((garment) => (
                <div
                  key={garment.id}
                  className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
                >
                  {garment.imageAccess ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={garment.imageAccess.url}
                      alt="Uploaded garment"
                      className="aspect-[3/4] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center text-3xl">
                      👗
                    </div>
                  )}
                  <div className="p-3">
                    <span className="block truncate font-mono text-xs text-zinc-500">
                      {garment.id}
                    </span>
                    <span className="mt-1 inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      {garment.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <GarmentCaptureModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onGarmentCommitted={handleGarmentCommitted}
      />
      <StickyBottomNav />
    </div>
  )
}
