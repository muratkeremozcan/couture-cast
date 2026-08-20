import type { WardrobeSilhouetteService } from '../../../../apps/api/src/modules/wardrobe/wardrobe-silhouette.service'
import {
  formatSilhouetteETag,
  parseSilhouetteIfMatchHeader,
} from '../../../../apps/api/src/modules/wardrobe/wardrobe-silhouette.service'
import type { UpdateSilhouetteSlidersInput } from '@couture/api-client/contracts/http'
import { NotFoundException, PreconditionFailedException } from '@nestjs/common'
import {
  PACT_SILHOUETTE_COMMITTED_AT,
  PACT_SILHOUETTE_COMMIT_IDEMPOTENCY_KEY,
  PACT_SILHOUETTE_IMAGE_EXPIRY,
  PACT_SILHOUETTE_UPDATED_AT,
  PACT_SILHOUETTE_UPLOAD_EXPIRY,
  PACT_SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY,
  PACT_SILHOUETTE_UPLOAD_SESSION_ID,
} from '../fixtures'
import { getProviderSilhouetteState, type SilhouetteRow } from '../state'

/**
 * Provider doubles for the silhouette surface.
 *
 * These were inline consts inside `startLocalPactProvider`, which held all
 * seventeen of them across 1164 lines. Only what the Nest fixture actually
 * registers is returned; the scenario readers and response shapers stay private
 * to this module.
 */
export function createSilhouetteDoubles() {
  const toSilhouetteResponse = (row: SilhouetteRow) => ({
    data: {
      mode: row.mode,
      heightSlider: row.heightSlider,
      buildSlider: row.buildSlider,
      myForm: row.myForm,
      revision: row.revision,
      updatedAt: PACT_SILHOUETTE_UPDATED_AT,
    },
  })

  const requireSilhouetteScenario = (): SilhouetteRow => {
    const state = getProviderSilhouetteState()
    if (!state) {
      throw new NotFoundException('SILHOUETTE_STATE_NOT_CONFIGURED')
    }
    switch (state.scenario) {
      case 'profile-exists':
      case 'guardian-forbidden':
      case 'my-form-awaiting-commit':
      case 'my-form-upload-already-allocated':
        return {
          mode: 'default_mannequin',
          heightSlider: 50,
          buildSlider: 50,
          myForm: null,
          revision: 1,
        }
      case 'stale-precondition':
        return {
          mode: 'default_mannequin',
          heightSlider: 50,
          buildSlider: 50,
          myForm: null,
          revision: 2,
        }
      case 'my-form-ready':
      case 'my-form-exists':
        return {
          mode: 'my_form',
          heightSlider: 50,
          buildSlider: 50,
          myForm: {
            status: 'ready',
            failureReason: null,
            committedAt: PACT_SILHOUETTE_COMMITTED_AT,
            imageAccess: {
              url: 'https://example.test/silhouette-my-form.png',
              expiresAt: PACT_SILHOUETTE_IMAGE_EXPIRY,
            },
          },
          revision: 3,
        }
      case 'my-form-failed':
      case 'my-form-privacy-violation-teen-notified':
        return {
          mode: 'default_mannequin',
          heightSlider: 50,
          buildSlider: 50,
          myForm: {
            status: 'failed',
            failureReason: state.failureReason ?? 'privacy_violation',
            committedAt: PACT_SILHOUETTE_COMMITTED_AT,
            imageAccess: null,
          },
          revision: 2,
        }
      case 'my-form-commit-already-processed':
        // Identical to a fresh commit's resulting row (see `commitMyForm`
        // below): the replay interaction asserts this exact shape stays
        // unchanged rather than being re-derived, proving no re-processing.
        return {
          mode: 'default_mannequin',
          heightSlider: 50,
          buildSlider: 50,
          myForm: {
            status: 'processing',
            failureReason: null,
            committedAt: PACT_SILHOUETTE_COMMITTED_AT,
            imageAccess: null,
          },
          revision: 2,
        }
    }
  }

  const mockWardrobeSilhouetteService = {
    getProfile: (userId: string) => {
      const row = requireSilhouetteScenario()
      return Promise.resolve({
        response: toSilhouetteResponse(row),
        etag: formatSilhouetteETag(userId, row.revision),
      })
    },
    updateSliders: (
      userId: string,
      ifMatchHeader: string | undefined,
      input: UpdateSilhouetteSlidersInput
    ) => {
      const expectedRevision = parseSilhouetteIfMatchHeader(ifMatchHeader, userId)
      const row = requireSilhouetteScenario()
      if (expectedRevision !== null && expectedRevision !== row.revision) {
        throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
      }

      const isIdenticalReplay =
        row.mode === 'default_mannequin' &&
        row.heightSlider === input.heightSlider &&
        row.buildSlider === input.buildSlider
      if (isIdenticalReplay) {
        return Promise.resolve({ response: toSilhouetteResponse(row), isNoOp: true })
      }

      const updated: SilhouetteRow = {
        mode: 'default_mannequin',
        heightSlider: input.heightSlider,
        buildSlider: input.buildSlider,
        myForm: row.myForm,
        revision: row.revision + 1,
      }
      return Promise.resolve({ response: toSilhouetteResponse(updated), isNoOp: false })
    },
    createMyFormUploadUrl: (
      _userId: string,
      _role: unknown,
      _input: unknown,
      idempotencyKey: string
    ) => {
      const state = getProviderSilhouetteState()
      requireSilhouetteScenario()
      // Mirrors `createMyFormUploadUrl`'s real
      // `existing.my_form_upload_idempotency_key === idempotencyKey` branch:
      // a repeated call with the same key replays the same session instead
      // of allocating a new one, and the controller's
      // `res.status(result.replayed ? 200 : 201)` reads this flag.
      const replayed =
        state?.scenario === 'my-form-upload-already-allocated' &&
        idempotencyKey === PACT_SILHOUETTE_UPLOAD_IDEMPOTENCY_KEY
      return Promise.resolve({
        replayed,
        response: {
          data: {
            uploadSessionId: PACT_SILHOUETTE_UPLOAD_SESSION_ID,
            uploadUrl: `https://api.example/wardrobe/silhouette/uploads/${PACT_SILHOUETTE_UPLOAD_SESSION_ID}`,
            uploadToken: 'token_my_form_upload',
            requiredHeaders: { 'content-type': 'image/png' as const },
            expiresAt: PACT_SILHOUETTE_UPLOAD_EXPIRY,
          },
        },
      })
    },
    commitMyForm: (
      _userId: string,
      _role: unknown,
      _input: unknown,
      idempotencyKey: string
    ) => {
      const state = getProviderSilhouetteState()
      const row = requireSilhouetteScenario()
      // Mirrors `commitMyForm`'s real
      // `profile.my_form_commit_idempotency_key === idempotencyKey` branch: a
      // repeated commit with the same key returns the existing row
      // unchanged (no re-processing, no revision increment, no re-enqueue).
      // Like upload-url, the real service returns `CommitResult['replayed']`
      // and the controller's `res.status(result.replayed ? 200 : 201)` reads
      // it, so a replay answers 200 where a first commit answers 201. The
      // flag must be set here: this stub is cast to the service type, so an
      // omitted `replayed` reads as `undefined` and silently pins 201.
      if (
        state?.scenario === 'my-form-commit-already-processed' &&
        idempotencyKey === PACT_SILHOUETTE_COMMIT_IDEMPOTENCY_KEY
      ) {
        return Promise.resolve({
          replayed: true,
          response: toSilhouetteResponse(row),
        })
      }
      const committed: SilhouetteRow = {
        mode: 'default_mannequin',
        heightSlider: row.heightSlider,
        buildSlider: row.buildSlider,
        myForm: {
          status: 'processing',
          failureReason: null,
          committedAt: PACT_SILHOUETTE_COMMITTED_AT,
          imageAccess: null,
        },
        revision: row.revision + 1,
      }
      return Promise.resolve({
        replayed: false,
        response: toSilhouetteResponse(committed),
      })
    },
    deleteMyForm: (userId: string, ifMatchHeader: string | undefined) => {
      const expectedRevision = parseSilhouetteIfMatchHeader(ifMatchHeader, userId)
      const row = requireSilhouetteScenario()
      if (expectedRevision !== null && expectedRevision !== row.revision) {
        throw new PreconditionFailedException('SILHOUETTE_REVISION_MISMATCH')
      }
      const deleted: SilhouetteRow = {
        mode: 'default_mannequin',
        heightSlider: row.heightSlider,
        buildSlider: row.buildSlider,
        myForm: null,
        revision: row.revision + 1,
      }
      return Promise.resolve({ response: toSilhouetteResponse(deleted) })
    },
  } as unknown as WardrobeSilhouetteService

  return { mockWardrobeSilhouetteService }
}
