import { Inject, Injectable } from '@nestjs/common'
import { context } from '@opentelemetry/api'
import { suppressTracing } from '@opentelemetry/core'
import type { RequestAuthContext } from '../auth/security.types.js'
import { verifyAndNormalizeCommunityImage } from '../community/community-image-validation.js'
import {
  MAX_GARMENT_IMAGE_BYTES,
  type GarmentMimeType,
} from '../wardrobe/wardrobe-image-validation.js'
import { PhotoAiGrantGate, type PhotoAiGrantScope } from './photo-ai-grant-gate.js'
import { PhotoAiSourceService, type PhotoAiSource } from './photo-ai-source.service.js'

const ATTEMPT_TIMEOUT_MS = 10_000

export type PhotoAiExecutionRequest = PhotoAiGrantScope & Readonly<{ photoId: string }>

export type PhotoAiProcessorInput = Readonly<{ bytes: Buffer; mimeType: GarmentMimeType }>

export type PhotoAiProcessor<T> = {
  readonly provider: string
  /** Begin transport during the call and honor the abort signal throughout processing. */
  process(input: PhotoAiProcessorInput, signal: AbortSignal): Promise<T>
}

function sameSource(source: PhotoAiSource, current: PhotoAiSource | null): boolean {
  return (
    current !== null &&
    current.memberId === source.memberId &&
    current.photoId === source.photoId &&
    current.inputClass === source.inputClass &&
    current.objectPath === source.objectPath &&
    current.mimeType === source.mimeType &&
    current.byteSize === source.byteSize &&
    current.sha256 === source.sha256
  )
}

function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
  discard?: (result: T) => void
): Promise<T | null> {
  return new Promise((resolve) => {
    const abort = () => resolve(null)
    const cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    void work.then(
      (result) => {
        cleanup()
        if (signal.aborted) discard?.(result)
        else resolve(result)
      },
      () => {
        cleanup()
        resolve(null)
      }
    )
  })
}

@Injectable()
export class PhotoAiExecutionService {
  constructor(
    @Inject(PhotoAiGrantGate) private readonly gate: PhotoAiGrantGate,
    @Inject(PhotoAiSourceService) private readonly sources: PhotoAiSourceService
  ) {}

  execute<T>(
    actor: Pick<RequestAuthContext, 'userId'>,
    request: PhotoAiExecutionRequest,
    processor: PhotoAiProcessor<T>
  ): Promise<T | null> {
    const attempt = { ...request }
    if (processor.provider !== attempt.provider) return Promise.resolve(null)
    // Storage instrumentation can capture an object path. The entire attempt is private.
    return context.with(suppressTracing(context.active()), () =>
      this.run(actor.userId, attempt, processor)
    )
  }

  private async run<T>(
    memberId: string,
    request: PhotoAiExecutionRequest,
    processor: PhotoAiProcessor<T>
  ): Promise<T | null> {
    if (!memberId) return null
    const attempt = new AbortController()
    const { signal } = attempt
    const finish = this.gate.trackAttempt(memberId, request.grantId, attempt)
    const timer = setTimeout(() => attempt.abort(), ATTEMPT_TIMEOUT_MS)
    let image: PhotoAiProcessorInput | null = null
    let released = false

    try {
      const source = await this.authorizeSource(memberId, request, signal)
      if (!source) return null

      image = await this.sanitize(source, signal)
      if (!image || signal.aborted) return null
      const input = image

      const started = await this.withFreshSource(source, request, signal, () => {
        if (processor.provider !== request.provider) return null
        // Capture the promise in a wrapper so the transaction releases the locks while it runs.
        return { pending: untilAborted(processor.process(input, signal), signal) }
      })
      if (!started) return null
      const output = await started.pending
      if (output == null || signal.aborted) return null

      const delivered = await this.withFreshSource(source, request, signal, () => true)
      released = delivered === true && !signal.aborted
      return released ? output : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      if (!released) attempt.abort()
      image?.bytes.fill(0)
      finish()
    }
  }

  private async authorizeSource(
    memberId: string,
    request: PhotoAiExecutionRequest,
    signal: AbortSignal
  ): Promise<PhotoAiSource | null> {
    const authorized = await this.gate.withGrant(
      memberId,
      request,
      async ({ tx, expiresAt }) => {
        const source = await this.sources.resolve(
          tx,
          memberId,
          request.inputClass,
          request.photoId
        )
        return { source, expiresAt }
      }
    )
    if (!authorized || signal.aborted || authorized.expiresAt.getTime() <= Date.now())
      return null
    const { source } = authorized
    return source &&
      source.memberId === memberId &&
      source.photoId === request.photoId &&
      source.inputClass === request.inputClass
      ? source
      : null
  }

  private withFreshSource<T>(
    source: PhotoAiSource,
    request: PhotoAiExecutionRequest,
    signal: AbortSignal,
    work: () => T | null
  ): Promise<T | null> {
    return this.gate.withGrant(source.memberId, request, async ({ tx, expiresAt }) => {
      if (signal.aborted) return null
      const current = await this.sources.resolve(
        tx,
        source.memberId,
        source.inputClass,
        source.photoId
      )
      if (
        !sameSource(source, current) ||
        expiresAt.getTime() <= Date.now() ||
        signal.aborted
      )
        return null
      return work()
    })
  }

  private async sanitize(
    source: PhotoAiSource,
    signal: AbortSignal
  ): Promise<PhotoAiProcessorInput | null> {
    const bytes = await untilAborted(this.sources.read(source, signal), signal, (late) =>
      late?.fill(0)
    )
    if (!bytes) return null
    try {
      const { bytes: sanitized, mimeType } = await verifyAndNormalizeCommunityImage(
        bytes,
        source,
        2,
        signal
      )
      if (sanitized.length > MAX_GARMENT_IMAGE_BYTES) {
        sanitized.fill(0)
        return null
      }
      return { bytes: sanitized, mimeType }
    } finally {
      bytes.fill(0)
    }
  }
}
