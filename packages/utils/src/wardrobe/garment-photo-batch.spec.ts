// Learning path Step 85: Add several photos at once.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-85-add-several-photos-at-once
import { assert, describe, expect, it, vi } from 'vitest'
import { GarmentPhotoBatch } from './garment-photo-batch'

function photo(source: string) {
  return { image: `crop:${source}`, preview: `preview:${source}`, fingerprint: source }
}

function setup() {
  let owner = 'member-a'
  const prepare = vi.fn<
    (source: string, signal: AbortSignal) => Promise<ReturnType<typeof photo>>
  >((source) => Promise.resolve(photo(source)))
  const releaseSource = vi.fn<(source: string) => void>()
  const releasePrepared = vi.fn<(prepared: ReturnType<typeof photo>) => void>()
  const upload = vi.fn<
    (
      image: string,
      session: string,
      attemptId: string,
      signal: AbortSignal
    ) => Promise<string>
  >((image) => Promise.resolve(`saved:${image}`))
  const onCommitted = vi.fn<(result: string) => void>()
  const batch = new GarmentPhotoBatch(
    {
      isCurrent: (session: string) => session === owner,
      prepare,
      releaseSource,
      releasePrepared,
      upload,
      onCommitted,
    },
    vi.fn()
  )
  function open() {
    const pick = batch.open(owner)
    assert(pick)
    return pick
  }
  function openRetry(rowId: number) {
    const pick = batch.openRetry(rowId)
    assert(pick)
    return pick
  }
  return {
    batch,
    open,
    openRetry,
    prepare,
    releaseSource,
    releasePrepared,
    upload,
    onCommitted,
    changeOwner: () => {
      owner = 'member-b'
    },
  }
}

function hold<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

describe('GarmentPhotoBatch', () => {
  it('[7.28-WEB-001] rejects all six sources and accepts five in the next selection', async () => {
    const { batch, open, prepare, releaseSource, upload } = setup()
    const sources = ['coat', 'skirt', 'shirt', 'hat', 'boots', 'scarf']
    await batch.accept(open(), sources)

    expect(batch.state).toMatchObject({
      phase: 'source',
      rows: [],
      pickerError: 'tooMany',
    })
    expect(prepare).not.toHaveBeenCalled()
    expect(releaseSource.mock.calls.map(([source]) => source)).toEqual(sources)

    await batch.accept(open(), sources.slice(0, 5))
    expect(batch.state).toMatchObject({
      phase: 'review',
      keptCount: 0,
      pickerError: undefined,
    })
    expect(batch.state.rows.map(({ preview }) => preview)).toEqual(
      sources.slice(0, 5).map((source) => photo(source).preview)
    )
    expect(upload).not.toHaveBeenCalled()
  })

  it('saves four kept rows sequentially and prevents a second click from replaying them', async () => {
    const { batch, open, upload, releasePrepared, onCommitted } = setup()
    const firstUpload = hold<string>()
    upload.mockReturnValueOnce(firstUpload.promise)
    await batch.accept(open(), ['coat', 'skirt', 'shirt', 'hat', 'boots'])
    await batch.save()
    expect(upload).not.toHaveBeenCalled()

    for (const rowId of [1, 2, 4, 5]) batch.toggleKeep(rowId)
    expect(batch.state.keptCount).toBe(4)
    const pendingSave = batch.save()
    await batch.save()
    expect(batch.state.rows.map(({ status }) => status)).toEqual([
      'uploading',
      'queued',
      'queued',
      'queued',
    ])
    expect(upload).toHaveBeenCalledTimes(1)
    expect(releasePrepared).toHaveBeenCalledExactlyOnceWith(photo('shirt'))

    firstUpload.resolve('saved:crop:coat')
    await pendingSave
    expect(upload.mock.calls.map(([image]) => image)).toEqual([
      'crop:coat',
      'crop:skirt',
      'crop:hat',
      'crop:boots',
    ])
    expect(onCommitted.mock.calls.flat()).toEqual([
      'saved:crop:coat',
      'saved:crop:skirt',
      'saved:crop:hat',
      'saved:crop:boots',
    ])
    expect(releasePrepared).toHaveBeenCalledTimes(5)
    expect(batch.state.rows.map(({ status, preview }) => [status, preview])).toEqual(
      Array.from({ length: 4 }, () => ['saved', undefined])
    )
  })

  it('releases an unreadable source and lets the other photo proceed', async () => {
    const { batch, open, prepare, releaseSource, upload } = setup()
    prepare.mockRejectedValueOnce(new Error('Cannot decode image'))
    await batch.accept(open(), ['broken-image', 'boots'])
    batch.toggleKeep(1)
    batch.toggleKeep(2)

    expect(batch.state.keptCount).toBe(1)
    expect(batch.state.rows.map(({ status }) => status)).toEqual(['invalid', 'ready'])
    expect(releaseSource.mock.calls.flat()).toEqual(['broken-image', 'boots'])
    await batch.save()
    expect(upload.mock.calls.map(([image]) => image)).toEqual(['crop:boots'])
    expect(batch.state.rows.map(({ status }) => status)).toEqual(['invalid', 'saved'])
  })

  it('[7.28-RETRY-001] clears a failed preview and retries the original photo with the same attempt', async () => {
    const { batch, open, openRetry, releasePrepared, upload, onCommitted } = setup()
    upload
      .mockResolvedValueOnce('saved:coat')
      .mockRejectedValueOnce(new Error('Response lost'))
    await batch.accept(open(), ['coat', 'boots'])
    batch.toggleKeep(1)
    batch.toggleKeep(2)
    await batch.save()

    expect(batch.state.rows).toMatchObject([
      { id: 1, status: 'saved', preview: undefined },
      { id: 2, status: 'failed', preview: undefined },
    ])
    expect(releasePrepared.mock.calls.flat()).toEqual([photo('coat'), photo('boots')])
    expect(batch.openRetry(1)).toBeNull()
    const pick = openRetry(2)
    batch.cancelPicker(pick)
    expect(batch.state.rows[1]?.status).toBe('failed')

    await batch.accept(openRetry(2), ['scarf'])
    expect(batch.state.rows[1]).toMatchObject({ status: 'failed', differentPhoto: true })
    expect(releasePrepared).toHaveBeenLastCalledWith(photo('scarf'))
    expect(upload).toHaveBeenCalledTimes(2)

    await batch.accept(openRetry(2), ['boots'])
    expect(upload.mock.calls.map(([image]) => image)).toEqual([
      'crop:coat',
      'crop:boots',
      'crop:boots',
    ])
    const attemptIds = upload.mock.calls.map(([, , attemptId]) => attemptId)
    expect(attemptIds[0]).not.toBe(attemptIds[1])
    expect(attemptIds[2]).toBe(attemptIds[1])
    expect(onCommitted.mock.calls.flat()).toEqual(['saved:coat', 'saved:crop:boots'])
    expect(batch.state.rows.map(({ status }) => status)).toEqual(['saved', 'saved'])
  })

  it('[7.28-CLEANUP-001] discards ready and late previews when the account changes during preparation', async () => {
    const { batch, open, changeOwner, prepare, releaseSource, releasePrepared, upload } =
      setup()
    const latePhoto = hold<ReturnType<typeof photo>>()
    prepare.mockResolvedValueOnce(photo('coat')).mockReturnValueOnce(latePhoto.promise)
    const pendingReview = batch.accept(open(), ['coat', 'boots', 'shirt'])
    await expect.poll(() => prepare.mock.calls.length).toBe(2)
    const signal = prepare.mock.calls[1]?.[1]

    changeOwner()
    batch.reset()
    expect(signal?.aborted).toBe(true)
    expect(releasePrepared.mock.calls.map(([prepared]) => prepared)).toEqual([
      photo('coat'),
    ])
    await batch.accept(open(), ['skirt'])

    latePhoto.resolve(photo('boots'))
    await pendingReview
    expect(releasePrepared.mock.calls.map(([prepared]) => prepared)).toEqual([
      photo('coat'),
      photo('boots'),
    ])
    expect(releaseSource.mock.calls.flat()).toEqual(['coat', 'skirt', 'boots', 'shirt'])
    expect(prepare.mock.calls.map(([source]) => source)).toEqual([
      'coat',
      'boots',
      'skirt',
    ])
    expect(batch.state.rows).toMatchObject([
      { status: 'ready', preview: 'preview:skirt' },
    ])
    expect(upload).not.toHaveBeenCalled()
  })

  it('releases a picker result arriving after cancel without preparing or uploading it', async () => {
    const { batch, open, prepare, releaseSource, upload } = setup()
    const pick = open()
    expect(batch.open('member-a')).toBeNull()
    batch.reset()
    await batch.accept(pick, ['coat'])

    expect(batch.state).toMatchObject({ phase: 'source', rows: [], busy: false })
    expect(releaseSource.mock.calls.map(([source]) => source)).toEqual(['coat'])
    expect(prepare).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('aborts an upload and discards its late result without starting the next row', async () => {
    const { batch, open, changeOwner, upload, releasePrepared, onCommitted } = setup()
    const lateCommit = hold<string>()
    upload.mockReturnValueOnce(lateCommit.promise)
    await batch.accept(open(), ['coat', 'boots'])
    batch.toggleKeep(1)
    batch.toggleKeep(2)
    const pendingSave = batch.save()
    const signal = upload.mock.calls[0]?.[3]

    changeOwner()
    batch.reset(false)
    expect(signal?.aborted).toBe(true)
    expect(releasePrepared.mock.calls.map(([prepared]) => prepared)).toEqual([
      photo('coat'),
      photo('boots'),
    ])
    lateCommit.resolve('saved:crop:coat')
    await pendingSave

    expect(upload).toHaveBeenCalledTimes(1)
    expect(onCommitted).not.toHaveBeenCalled()
    expect(batch.state).toMatchObject({ phase: 'source', rows: [], busy: false })
  })
})
