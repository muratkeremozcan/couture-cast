export const GARMENT_PHOTO_BATCH_LIMIT = 5

type RowStatus =
  | 'preparing'
  | 'ready'
  | 'invalid'
  | 'queued'
  | 'uploading'
  | 'saved'
  | 'failed'

export type GarmentPhotoBatchPickerError = 'tooMany' | 'pickerFailed'
export type GarmentPhotoBatchBlock = 'consentRequired' | 'signedOut'

export type GarmentPhotoBatchRow = {
  id: number
  status: RowStatus
  preview?: string
  keep: boolean
  differentPhoto?: boolean
}

export type GarmentPhotoBatchState = {
  rows: GarmentPhotoBatchRow[]
  phase: 'source' | 'review' | 'results'
  busy: boolean
  keptCount: number
  pickerError?: GarmentPhotoBatchPickerError
  blocked?: GarmentPhotoBatchBlock
}

type PreparedPhoto<Image> = { image: Image; preview: string; fingerprint: string }

export type GarmentPhotoBatchPick = { rowId?: number }

type BatchAdapter<Source, Image, Session, Result> = {
  isCurrent: (session: Session) => boolean
  prepare: (source: Source, signal: AbortSignal) => Promise<PreparedPhoto<Image>>
  releaseSource: (source: Source) => void
  releasePrepared: (prepared: PreparedPhoto<Image>) => void
  upload: (
    image: Image,
    session: Session,
    attemptId: string,
    signal: AbortSignal
  ) => Promise<Result>
  classifyBlock: (error: unknown) => GarmentPhotoBatchBlock | undefined
  onCommitted: (result: Result) => void
}

type ActiveBatch<Session> = {
  id: number
  session: Session
  controller: AbortController
}

const emptyState: GarmentPhotoBatchState = {
  rows: [],
  phase: 'source',
  busy: false,
  keptCount: 0,
}
let nextBatchId = 0

/** Owns the local resources for one Closet review and fences asynchronous work at reset. */
export class GarmentPhotoBatch<Source, Image, Session, Result> {
  state = emptyState

  private active: ActiveBatch<Session> | null = null
  private pick: GarmentPhotoBatchPick | null = null
  private readonly prepared = new Map<number, PreparedPhoto<Image>>()
  private readonly fingerprints = new Map<number, string>()

  constructor(
    private readonly adapter: BatchAdapter<Source, Image, Session, Result>,
    private readonly onChange: (state: GarmentPhotoBatchState) => void
  ) {}

  open(session: Session): GarmentPhotoBatchPick | null {
    if (this.state.phase !== 'source' || this.pick || !this.adapter.isCurrent(session)) {
      return null
    }
    this.active = {
      id: ++nextBatchId,
      session,
      controller: new AbortController(),
    }
    this.pick = {}
    this.update({ pickerError: undefined })
    return this.pick
  }

  openRetry(rowId: number): GarmentPhotoBatchPick | null {
    if (
      !this.owns(this.active) ||
      this.pick ||
      this.state.busy ||
      this.state.blocked ||
      this.state.rows.find((row) => row.id === rowId)?.status !== 'failed'
    ) {
      return null
    }
    this.pick = { rowId }
    this.update({ pickerError: undefined })
    return this.pick
  }

  cancelPicker(pick: GarmentPhotoBatchPick, pickerError?: GarmentPhotoBatchPickerError) {
    if (pick !== this.pick) return
    this.pick = null
    this.update({ pickerError })
  }

  async accept(pick: GarmentPhotoBatchPick, sources: readonly Source[]) {
    const batch = this.active
    if (pick !== this.pick || !this.owns(batch)) {
      sources.forEach(this.adapter.releaseSource)
      return
    }
    if (
      sources.length === 0 ||
      sources.length > (pick.rowId ? 1 : GARMENT_PHOTO_BATCH_LIMIT)
    ) {
      sources.forEach(this.adapter.releaseSource)
      this.cancelPicker(pick, sources.length ? 'tooMany' : undefined)
      return
    }
    this.pick = null
    if (pick.rowId !== undefined) {
      for (const source of sources) await this.retry(batch, pick.rowId, source)
      return
    }

    const rows = sources.map(
      (_, index): GarmentPhotoBatchRow => ({
        id: index + 1,
        status: 'preparing',
        keep: false,
      })
    )
    this.update({ phase: 'review', rows, busy: true })
    for (const [index, source] of sources.entries()) {
      const photo = await this.prepare(batch, source)
      if (!this.owns(batch)) continue
      const id = index + 1
      if (photo) {
        this.prepared.set(id, photo)
        this.fingerprints.set(id, photo.fingerprint)
        this.updateRow(id, { status: 'ready', preview: photo.preview })
      } else {
        this.updateRow(id, { status: 'invalid' })
      }
    }
    if (this.owns(batch)) this.update({ busy: false })
  }

  toggleKeep(rowId: number) {
    if (this.state.phase !== 'review') return
    const row = this.state.rows.find((item) => item.id === rowId)
    if (row?.status === 'ready') this.updateRow(rowId, { keep: !row.keep })
  }

  async save() {
    const batch = this.active
    if (
      !this.owns(batch) ||
      this.state.phase !== 'review' ||
      this.state.busy ||
      this.state.keptCount === 0
    ) {
      return
    }
    const rows = this.state.rows.flatMap((row): GarmentPhotoBatchRow[] => {
      if (row.keep) return [{ ...row, status: 'queued' }]
      this.release(row.id)
      this.fingerprints.delete(row.id)
      return row.status === 'invalid' ? [row] : []
    })
    this.update({ phase: 'results', rows, busy: true })
    for (const row of rows) {
      if (!this.owns(batch) || this.state.blocked) return
      const photo = this.prepared.get(row.id)
      if (photo) await this.upload(batch, row.id, photo)
    }
    if (this.owns(batch) && !this.state.blocked) this.update({ busy: false })
  }

  /** Cleanup also runs on unmount, when there is no state to publish. */
  reset(publish = true) {
    this.active?.controller.abort()
    this.active = null
    this.pick = null
    this.clearPhotos()
    this.state = emptyState
    if (publish) this.onChange(this.state)
  }

  private owns(batch: ActiveBatch<Session> | null): batch is ActiveBatch<Session> {
    return (
      batch !== null && this.active === batch && this.adapter.isCurrent(batch.session)
    )
  }

  private async prepare(batch: ActiveBatch<Session>, source: Source) {
    try {
      if (!this.owns(batch)) return null
      const photo = await this.adapter.prepare(source, batch.controller.signal)
      if (this.owns(batch)) return photo
      this.adapter.releasePrepared(photo)
    } catch {
      // Each malformed or unreadable image fails independently.
    } finally {
      this.adapter.releaseSource(source)
    }
    return null
  }

  private async retry(batch: ActiveBatch<Session>, id: number, source: Source) {
    this.update({ busy: true })
    this.updateRow(id, { status: 'preparing', differentPhoto: false })
    const photo = await this.prepare(batch, source)
    if (!this.owns(batch)) return
    if (photo && photo.fingerprint === this.fingerprints.get(id)) {
      this.prepared.set(id, photo)
      this.updateRow(id, { preview: photo.preview })
      await this.upload(batch, id, photo)
    } else {
      if (photo) this.adapter.releasePrepared(photo)
      this.updateRow(id, { status: 'failed', differentPhoto: true })
    }
    if (this.owns(batch) && !this.state.blocked) this.update({ busy: false })
  }

  private async upload(
    batch: ActiveBatch<Session>,
    id: number,
    photo: PreparedPhoto<Image>
  ) {
    this.updateRow(id, { status: 'uploading' })
    let outcome: { result: Result } | undefined
    let blocked: GarmentPhotoBatchBlock | undefined
    try {
      const result = await this.adapter.upload(
        photo.image,
        batch.session,
        `batch:${batch.id}:${id}`,
        batch.controller.signal
      )
      outcome = { result }
    } catch (error) {
      blocked = this.adapter.classifyBlock(error)
    }
    if (!this.owns(batch)) return
    if (blocked) {
      this.clearPhotos()
      this.update({
        blocked,
        busy: false,
        rows: this.state.rows.map((row) =>
          row.status === 'uploading' || row.status === 'queued'
            ? { ...row, status: 'failed', preview: undefined }
            : row
        ),
      })
      return
    }
    // Other failures keep the fingerprint and row identity for an explicit retry.
    this.release(id)
    this.updateRow(id, { status: outcome ? 'saved' : 'failed', preview: undefined })
    if (outcome) {
      this.fingerprints.delete(id)
      this.adapter.onCommitted(outcome.result)
    }
  }

  private release(id: number) {
    const photo = this.prepared.get(id)
    if (!photo) return
    this.prepared.delete(id)
    this.adapter.releasePrepared(photo)
  }

  private clearPhotos() {
    this.prepared.forEach(this.adapter.releasePrepared)
    this.prepared.clear()
    this.fingerprints.clear()
  }

  private updateRow(id: number, patch: Partial<GarmentPhotoBatchRow>) {
    this.update({
      rows: this.state.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    })
  }

  private update(patch: Partial<GarmentPhotoBatchState>) {
    const state = { ...this.state, ...patch }
    state.keptCount = state.rows.filter((row) => row.keep).length
    this.state = state
    this.onChange(state)
  }
}
