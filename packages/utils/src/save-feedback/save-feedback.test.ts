// Learning path Step 59: Shared save, undo and status feedback.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-59-shared-save-undo-and-status-feedback
import { describe, expect, it, vi } from 'vitest'
import {
  clampStatusBarActions,
  createAnnouncementToken,
  createSaveFeedbackSnapshot,
  createStatusBarNotice,
  DEFAULT_MAX_LOOK_UNDO_DEPTH,
  getSaveFeedbackUrgency,
  isOfflineError,
  isSaveFeedbackBusy,
  MAX_STATUS_BAR_ACTIONS,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  reduceSaveFeedback,
  SAVE_FEEDBACK_TIMINGS,
  type StatusBarAction,
} from './index'

describe('save-feedback state machine and helpers', () => {
  it('exposes the exact timing and action limit constants', () => {
    expect(SAVE_FEEDBACK_TIMINGS).toEqual({
      savingResponseMs: 100,
      stillSavingAfterMs: 1_000,
      statusBarDurationMs: 5_000,
      maxTransitionMs: 200,
    })
    expect(MAX_STATUS_BAR_ACTIONS).toBe(2)
    expect(DEFAULT_MAX_LOOK_UNDO_DEPTH).toBe(10)
  })

  it('transitions cleanly through idle -> saving -> saved (fast commit)', () => {
    const initial = createSaveFeedbackSnapshot()
    expect(initial).toEqual({
      state: 'idle',
      runId: 0,
      announcementId: null,
      errorMessage: null,
    })

    const saving = reduceSaveFeedback(initial, { type: 'start', runId: 1 })
    expect(saving.state).toBe('saving')
    expect(saving.runId).toBe(1)
    expect(saving.announcementId).toBe('saving:1')
    expect(isSaveFeedbackBusy(saving.state)).toBe(true)

    const saved = reduceSaveFeedback(saving, { type: 'succeed', runId: 1 })
    expect(saved.state).toBe('saved')
    expect(saved.announcementId).toBe('saved:1')
    expect(saved.errorMessage).toBeNull()
    expect(isSaveFeedbackBusy(saved.state)).toBe(false)
  })

  it('transitions cleanly through idle -> saving -> still-saving -> saved (slow commit)', () => {
    const saving = reduceSaveFeedback(createSaveFeedbackSnapshot(), {
      type: 'start',
      runId: 1,
    })
    const stillSaving = reduceSaveFeedback(saving, { type: 'slow', runId: 1 })
    expect(stillSaving.state).toBe('still-saving')
    expect(stillSaving.announcementId).toBe('still-saving:1')
    expect(isSaveFeedbackBusy(stillSaving.state)).toBe(true)

    const saved = reduceSaveFeedback(stillSaving, { type: 'succeed', runId: 1 })
    expect(saved.state).toBe('saved')
    expect(saved.announcementId).toBe('saved:1')
  })

  it('transitions cleanly through saving -> failed -> retry -> saved', () => {
    const saving = reduceSaveFeedback(createSaveFeedbackSnapshot(), {
      type: 'start',
      runId: 1,
    })
    const failed = reduceSaveFeedback(saving, {
      type: 'fail',
      runId: 1,
      errorMessage: 'Could not save. Try again.',
    })
    expect(failed.state).toBe('failed')
    expect(failed.errorMessage).toBe('Could not save. Try again.')
    expect(failed.announcementId).toBe('failed:1')

    const retrying = reduceSaveFeedback(failed, { type: 'start', runId: 2 })
    expect(retrying.state).toBe('saving')
    expect(retrying.errorMessage).toBeNull()
    expect(retrying.announcementId).toBe('saving:2')

    const saved = reduceSaveFeedback(retrying, { type: 'succeed', runId: 2 })
    expect(saved.state).toBe('saved')
    expect(saved.announcementId).toBe('saved:2')
  })

  it('handles offline and undo transitions with unique announcement tokens', () => {
    const offline = reduceSaveFeedback(createSaveFeedbackSnapshot(), {
      type: 'offline',
      runId: 1,
    })
    expect(offline.state).toBe('offline')
    expect(offline.announcementId).toBe('offline:1')

    const saving = reduceSaveFeedback(offline, { type: 'start', runId: 2 })
    const saved = reduceSaveFeedback(saving, { type: 'succeed', runId: 2 })
    const undone = reduceSaveFeedback(saved, { type: 'undo', runId: 3 })
    expect(undone.state).toBe('idle')
    expect(undone.runId).toBe(3)
    expect(undone.announcementId).toBe('undo:3')
  })

  it('ignores stale or superseded async completions and invalid transitions', () => {
    const initial = createSaveFeedbackSnapshot()
    // Cannot succeed, fail, or go slow from idle
    expect(reduceSaveFeedback(initial, { type: 'slow', runId: 0 })).toBe(initial)
    expect(reduceSaveFeedback(initial, { type: 'succeed', runId: 0 })).toBe(initial)
    expect(reduceSaveFeedback(initial, { type: 'fail', runId: 0 })).toBe(initial)

    const run1 = reduceSaveFeedback(initial, { type: 'start', runId: 1 })
    const run2 = reduceSaveFeedback(run1, { type: 'start', runId: 2 })
    // Stale run 1 completions are ignored
    expect(reduceSaveFeedback(run2, { type: 'slow', runId: 1 })).toBe(run2)
    expect(reduceSaveFeedback(run2, { type: 'succeed', runId: 1 })).toBe(run2)
    expect(reduceSaveFeedback(run2, { type: 'fail', runId: 1 })).toBe(run2)
    expect(reduceSaveFeedback(run2, { type: 'start', runId: 1 })).toBe(run2)
    expect(reduceSaveFeedback(run2, { type: 'offline', runId: 2 })).toBe(run2)
    expect(reduceSaveFeedback(run2, { type: 'undo', runId: 1 })).toBe(run2)

    // Reset bumps runId so an in-flight run 2 cannot overwrite the reset state
    const reset = reduceSaveFeedback(run2, { type: 'reset' })
    expect(reset.state).toBe('idle')
    expect(reset.runId).toBe(3)
    expect(reduceSaveFeedback(reset, { type: 'succeed', runId: 2 })).toBe(reset)

    const resetSaved = reduceSaveFeedback(reset, {
      type: 'reset',
      nextState: 'saved',
    })
    expect(resetSaved.state).toBe('saved')
    expect(resetSaved.runId).toBe(4)
  })

  it('clamps status bar actions to at most 2 in order', () => {
    const actions: StatusBarAction[] = [
      { id: 'view', kind: 'view', label: 'View', onPress: vi.fn() },
      { id: 'undo', kind: 'undo', label: 'Undo', onPress: vi.fn() },
      { id: 'retry', kind: 'retry', label: 'Retry', onPress: vi.fn() },
    ]
    expect(clampStatusBarActions(actions).map((a) => a.id)).toEqual(['view', 'undo'])
    expect(clampStatusBarActions(actions, 1).map((a) => a.id)).toEqual(['view'])
    expect(clampStatusBarActions(actions, 0)).toEqual([])

    const notice = createStatusBarNotice({
      id: 'notice-1',
      message: 'Saved to your looks.',
      tone: 'success',
      actions,
    })
    expect(notice.actions.map((a) => a.id)).toEqual(['view', 'undo'])
    expect(notice.durationMs).toBe(5_000)
    expect(notice.urgency).toBe('polite')
    expect(notice.announcementId).toBe(createAnnouncementToken('success', 'notice-1'))
  })

  it('maps announcement urgency cleanly for polite and assertive states', () => {
    expect(getSaveFeedbackUrgency('idle')).toBe('polite')
    expect(getSaveFeedbackUrgency('saving')).toBe('polite')
    expect(getSaveFeedbackUrgency('still-saving')).toBe('polite')
    expect(getSaveFeedbackUrgency('saved')).toBe('polite')
    expect(getSaveFeedbackUrgency('neutral')).toBe('polite')
    expect(getSaveFeedbackUrgency('success')).toBe('polite')
    expect(getSaveFeedbackUrgency('failed')).toBe('assertive')
    expect(getSaveFeedbackUrgency('error')).toBe('assertive')
    expect(getSaveFeedbackUrgency('offline')).toBe('assertive')
  })

  it('maintains a bounded immutable undo stack for unsaved looks', () => {
    let stack: string[] = []
    stack = pushLookUndoSnapshot(stack, 'look-1', 2)
    stack = pushLookUndoSnapshot(stack, 'look-2', 2)
    stack = pushLookUndoSnapshot(stack, 'look-3', 2)
    expect(stack).toEqual(['look-2', 'look-3'])
    expect(pushLookUndoSnapshot(stack, 'look-4', 0)).toEqual([])

    const firstPop = popLookUndoSnapshot(stack)
    expect(firstPop.snapshot).toBe('look-3')
    expect(firstPop.rest).toEqual(['look-2'])
    expect(stack).toEqual(['look-2', 'look-3'])

    const secondPop = popLookUndoSnapshot(firstPop.rest)
    expect(secondPop.snapshot).toBe('look-2')
    expect(secondPop.rest).toEqual([])

    const emptyPop = popLookUndoSnapshot(secondPop.rest)
    expect(emptyPop.snapshot).toBeUndefined()
    expect(emptyPop.rest).toEqual([])
  })

  it('classifies offline and network errors reliably', () => {
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isOfflineError(new TypeError('Network request failed'))).toBe(true)
    expect(isOfflineError(new Error('Load failed'))).toBe(true)
    expect(isOfflineError({ code: 'ERR_NETWORK' })).toBe(true)
    expect(isOfflineError({ name: 'OfflineError' })).toBe(true)
    expect(isOfflineError('The Internet connection appears to be offline')).toBe(true)
    expect(
      isOfflineError({ cause: new Error('NetworkError when attempting to fetch') })
    ).toBe(true)
    expect(isOfflineError(new Error('QuotaExceededError'))).toBe(false)
    expect(isOfflineError(null)).toBe(false)
    expect(isOfflineError(42)).toBe(false)
  })
})
