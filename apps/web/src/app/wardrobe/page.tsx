// Story 4.1 & 4.2 owner: implement web wardrobe hub page with capture and smart tagging
'use client'

import React, { useEffect, useState, useRef } from 'react'
import type { GarmentItemContract } from '@couture/api-client/contracts/http'
import { SkipToContent } from '../components/skip-to-content'
import { GarmentCaptureModal } from '../components/garment-capture-modal'
import { GarmentTaggingModal } from '../components/garment-tagging-modal'
import { StickyBottomNav } from '../components/sticky-bottom-nav'
import { listGarmentsFromWeb } from '../../lib/wardrobe'

export default function WardrobePage() {
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false)
  const [taggingGarmentId, setTaggingGarmentId] = useState<string | null>(null)
  const [garments, setGarments] = useState<GarmentItemContract[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [timedOutGarmentIds, setTimedOutGarmentIds] = useState<Set<string>>(
    () => new Set()
  )
  const addGarmentButtonRef = useRef<HTMLButtonElement | null>(null)
  const captureInvokerRef = useRef<HTMLElement | null>(null)
  const taggingInvokerRef = useRef<HTMLElement | null>(null)
  const taggingButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingTaggingGarmentIdRef = useRef<string | null>(null)
  const isCaptureOpenRef = useRef(false)
  const pollingControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    isCaptureOpenRef.current = isCaptureModalOpen
  }, [isCaptureModalOpen])

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
    return () => {
      controller.abort()
      pollingControllerRef.current?.abort()
    }
  }, [])

  const openCapture = (invoker: HTMLElement) => {
    captureInvokerRef.current = invoker
    setIsCaptureModalOpen(true)
  }

  const openTagging = (garmentId: string, invoker?: HTMLElement | null) => {
    taggingInvokerRef.current =
      invoker ??
      taggingButtonRefs.current.get(garmentId) ??
      (captureInvokerRef.current?.isConnected ? captureInvokerRef.current : null) ??
      addGarmentButtonRef.current
    setTaggingGarmentId(garmentId)
  }

  const waitForPoll = (delayMs: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, delayMs)
      signal.addEventListener(
        'abort',
        () => {
          window.clearTimeout(timer)
          reject(new DOMException('Polling aborted', 'AbortError'))
        },
        { once: true }
      )
    })

  const pollCommittedGarment = (garmentId: string) => {
    pollingControllerRef.current?.abort()
    const controller = new AbortController()
    pollingControllerRef.current = controller

    void (async () => {
      try {
        const startedAt = Date.now()
        for (const offsetMs of [1_000, 2_000, 4_000, 8_000]) {
          await waitForPoll(
            Math.max(0, startedAt + offsetMs - Date.now()),
            controller.signal
          )
          const persisted = await listGarmentsFromWeb(controller.signal)
          setGarments(persisted)
          const current = persisted.find((garment) => garment.id === garmentId)
          if (!current || current.status === 'processing') continue
          setTimedOutGarmentIds((ids) => {
            const next = new Set(ids)
            next.delete(garmentId)
            return next
          })
          if (current.status === 'awaiting_tags') {
            if (isCaptureOpenRef.current) {
              pendingTaggingGarmentIdRef.current = current.id
            } else {
              openTagging(current.id)
            }
          }
          return
        }
        setTimedOutGarmentIds((ids) => new Set(ids).add(garmentId))
        setLoadError(
          'Smart tagging is taking longer than expected. The garment will remain visible while processing continues.'
        )
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error ? error.message : 'Unable to refresh garment status.'
          )
        }
      }
    })()
  }

  const handleGarmentCommitted = (garment: GarmentItemContract) => {
    setGarments((current) => [
      garment,
      ...current.filter((item) => item.id !== garment.id),
    ])
    if (garment.status === 'awaiting_tags') {
      pendingTaggingGarmentIdRef.current = garment.id
    } else if (garment.status === 'processing') {
      pollCommittedGarment(garment.id)
    }
  }

  const closeCapture = () => {
    setIsCaptureModalOpen(false)
    const pendingGarmentId = pendingTaggingGarmentIdRef.current
    pendingTaggingGarmentIdRef.current = null
    if (pendingGarmentId) {
      window.requestAnimationFrame(() => openTagging(pendingGarmentId))
    }
  }

  const handleTagsConfirmed = (updatedGarment: GarmentItemContract) => {
    const recordedButton = taggingButtonRefs.current.get(updatedGarment.id)
    if (
      !taggingInvokerRef.current?.isConnected ||
      taggingInvokerRef.current === recordedButton
    ) {
      taggingInvokerRef.current = addGarmentButtonRef.current
    }
    setGarments((current) =>
      current.map((item) => (item.id === updatedGarment.id ? updatedGarment : item))
    )
    setTaggingGarmentId(null)
    void listGarmentsFromWeb()
      .then((persisted) => setGarments(persisted))
      .catch((error: unknown) => {
        setLoadError(
          error instanceof Error ? error.message : 'Unable to refresh your wardrobe.'
        )
      })
  }

  return (
    <>
      <div
        data-app-shell
        className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <SkipToContent />

        <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Wardrobe Hub
            </h1>
            <button
              ref={addGarmentButtonRef}
              onClick={(event) => openCapture(event.currentTarget)}
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
                  onClick={(event) => openCapture(event.currentTarget)}
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
                    data-testid={`garment-card-${garment.id}`}
                    className="flex flex-col justify-between overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
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
                    <div className="flex flex-col gap-2 p-3">
                      <span className="block truncate font-mono text-xs text-zinc-500">
                        {garment.id}
                      </span>
                      <div className="flex items-center justify-between">
                        <span
                          data-testid={`garment-status-${garment.status}`}
                          className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                        >
                          {garment.status.replace('_', ' ')}
                        </span>
                        {(garment.status === 'awaiting_tags' ||
                          timedOutGarmentIds.has(garment.id)) && (
                          <button
                            ref={(element) => {
                              if (element)
                                taggingButtonRefs.current.set(garment.id, element)
                              else taggingButtonRefs.current.delete(garment.id)
                            }}
                            onClick={(event) =>
                              openTagging(garment.id, event.currentTarget)
                            }
                            className="min-h-[44px] min-w-[44px] rounded bg-gold-500/20 px-2 py-1 text-xs font-semibold text-gold-700 hover:bg-gold-500/30 dark:text-gold-300"
                          >
                            Needs tags
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>

        <StickyBottomNav />
      </div>

      <GarmentCaptureModal
        isOpen={isCaptureModalOpen}
        onClose={closeCapture}
        onGarmentCommitted={handleGarmentCommitted}
        invokingElementRef={captureInvokerRef}
      />

      <GarmentTaggingModal
        isOpen={Boolean(taggingGarmentId)}
        onClose={() => setTaggingGarmentId(null)}
        garmentId={taggingGarmentId}
        onTagsConfirmed={handleTagsConfirmed}
        invokingElementRef={taggingInvokerRef}
      />
    </>
  )
}
