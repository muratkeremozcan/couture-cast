import { Injectable, Module } from '@nestjs/common'

@Injectable()
export class PhotoAiAttemptRegistry {
  private readonly activeAttempts = new Map<string, Set<AbortController>>()

  track(memberId: string, grantId: string, attempt: AbortController): () => void {
    const key = JSON.stringify([memberId, grantId])
    const attempts = this.activeAttempts.get(key) ?? new Set<AbortController>()
    attempts.add(attempt)
    this.activeAttempts.set(key, attempts)
    return () => {
      attempts.delete(attempt)
      if (attempts.size === 0) this.activeAttempts.delete(key)
    }
  }

  abort(memberId: string, grantId: string): void {
    const key = JSON.stringify([memberId, grantId])
    for (const attempt of this.activeAttempts.get(key) ?? []) attempt.abort()
  }
}

@Module({
  providers: [PhotoAiAttemptRegistry],
  exports: [PhotoAiAttemptRegistry],
})
export class PhotoAiAttemptModule {}
