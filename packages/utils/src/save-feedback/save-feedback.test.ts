// Learning path Step 59: Shared save, undo and status feedback.
// See _bmad-output/project-knowledge/learning-path-step-by-step.md#step-59-shared-save-undo-and-status-feedback
import { describe, expect, it, vi } from 'vitest'
import {
  applyBoundedListRemove,
  applyBoundedListSave,
  clampStatusBarActions,
  createAnnouncementToken,
  createSaveFeedbackSnapshot,
  createStatusBarNotice,
  DEFAULT_MAX_LOOK_UNDO_DEPTH,
  DEFAULT_MAX_SAVED_ENTRIES,
  getSaveFeedbackUrgency,
  isOfflineError,
  isSaveFeedbackBusy,
  MAX_STATUS_BAR_ACTIONS,
  popLookUndoSnapshot,
  pushLookUndoSnapshot,
  reduceSaveFeedback,
  SAVE_FEEDBACK_TIMINGS,
  undoBoundedListRemove,
  undoBoundedListSave,
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

  it('restores evicted 8th entry when undoing a save into a full 8-entry list', () => {
    type Item = { id: string; rev: number }
    const initial: Item[] = Array.from({ length: DEFAULT_MAX_SAVED_ENTRIES }, (_, i) => ({
      id: `look-${i + 1}`,
      rev: 1,
    }))
    const getKey = (item: Item) => item.id
    const isSame = (a: Item, b: Item) => a.id === b.id && a.rev === b.rev

    const mutation = applyBoundedListSave({
      entries: initial,
      entry: { id: 'look-9', rev: 1 },
      getKey,
    })
    expect(mutation.next).toHaveLength(8)
    expect(mutation.next[0]).toEqual({ id: 'look-9', rev: 1 })
    expect(mutation.evictedEntry).toEqual({ id: 'look-8', rev: 1 })

    const undone = undoBoundedListSave({
      entries: mutation.next,
      mutation,
      getKey,
      isSameEntry: isSame,
    })
    expect(undone.ok).toBe(true)
    expect(undone.next).toEqual(initial)
  })

  it('rejects Undo Save on concurrent overwrite and restores prior entry on update Undo', () => {
    type Item = { id: string; rev: number }
    const initial: Item[] = [
      { id: 'look-1', rev: 1 },
      { id: 'look-2', rev: 1 },
    ]
    const getKey = (item: Item) => item.id
    const isSame = (a: Item, b: Item) => a.id === b.id && a.rev === b.rev

    const updateMutation = applyBoundedListSave({
      entries: initial,
      entry: { id: 'look-2', rev: 2 },
      getKey,
    })
    expect(updateMutation.next).toEqual([
      { id: 'look-2', rev: 2 },
      { id: 'look-1', rev: 1 },
    ])

    // Concurrent edit changes look-2 to rev 3 -> Undo detects conflict and preserves fresh list
    const concurrentFresh: Item[] = [
      { id: 'look-2', rev: 3 },
      { id: 'look-1', rev: 1 },
    ]
    const conflict = undoBoundedListSave({
      entries: concurrentFresh,
      mutation: updateMutation,
      getKey,
      isSameEntry: isSame,
    })
    expect(conflict).toEqual({ ok: false, conflict: true, next: concurrentFresh })

    // Without conflict, Undo restores look-2 rev 1 at its prior index
    const cleanUndo = undoBoundedListSave({
      entries: updateMutation.next,
      mutation: updateMutation,
      getKey,
      isSameEntry: isSame,
    })
    expect(cleanUndo).toEqual({ ok: true, next: initial })
  })

  it('refuses Undo Remove when another tab refilled the list to capacity (8 entries)', () => {
    type Item = { id: string }
    const initial: Item[] = Array.from({ length: 8 }, (_, i) => ({
      id: `look-${i + 1}`,
    }))
    const getKey = (item: Item) => item.id

    const removed = applyBoundedListRemove({
      entries: initial,
      key: 'look-3',
      getKey,
    })
    expect(removed).not.toBeNull()
    expect(removed!.next).toHaveLength(7)

    // Another tab adds look-9, refilling to 8 entries
    const refilled: Item[] = [{ id: 'look-9' }, ...removed!.next]
    expect(refilled).toHaveLength(8)

    const conflict = undoBoundedListRemove({
      entries: refilled,
      mutation: removed!,
      getKey,
    })
    expect(conflict).toEqual({ ok: false, conflict: true, next: refilled })
    expect(conflict.next).toHaveLength(8)

    // When space exists (< 8), Undo restores look-3 at its prior index
    const restored = undoBoundedListRemove({
      entries: removed!.next,
      mutation: removed!,
      getKey,
    })
    expect(restored).toEqual({ ok: true, next: initial })
  })

  it('covers bounded list conflict edge cases, notice defaults, and cyclic/unrecognized offline errors', () => {
    // createStatusBarNotice defaults and explicit overrides
    const defaultNotice = createStatusBarNotice({ id: 'plain', message: 'Updated' })
    expect(defaultNotice.tone).toBe('neutral')
    expect(defaultNotice.actions).toEqual([])
    expect(defaultNotice.durationMs).toBe(5_000)

    const customNotice = createStatusBarNotice({
      id: 'custom',
      announcementId: 'explicit:1',
      message: 'Custom',
      tone: 'error',
      urgency: 'polite',
      durationMs: 2_500,
    })
    expect(customNotice.announcementId).toBe('explicit:1')
    expect(customNotice.urgency).toBe('polite')
    expect(customNotice.durationMs).toBe(2_500)

    // fail without errorMessage defaults errorMessage to null
    const saving = reduceSaveFeedback(createSaveFeedbackSnapshot(), {
      type: 'start',
      runId: 1,
    })
    expect(reduceSaveFeedback(saving, { type: 'fail', runId: 1 }).errorMessage).toBeNull()

    // applyBoundedListRemove missing key returns null
    type Item = { id: string; rev: number }
    const getKey = (item: Item) => item.id
    const isSame = (a: Item, b: Item) => a.id === b.id && a.rev === b.rev
    expect(
      applyBoundedListRemove({ entries: [{ id: 'a', rev: 1 }], key: 'missing', getKey })
    ).toBeNull()

    // undoBoundedListSave when saved key is already removed (!currentMatch)
    const saved = applyBoundedListSave({
      entries: [{ id: 'a', rev: 1 }],
      entry: { id: 'b', rev: 1 },
      getKey,
      maxEntries: 2,
    })
    expect(
      undoBoundedListSave({
        entries: [{ id: 'a', rev: 1 }],
        mutation: saved,
        getKey,
        isSameEntry: isSame,
        maxEntries: 2,
      })
    ).toEqual({ ok: false, conflict: true, next: [{ id: 'a', rev: 1 }] })

    // undoBoundedListSave when next.length > maxEntries (line 302)
    const oversizedUpdate = applyBoundedListSave({
      entries: [
        { id: 'a', rev: 1 },
        { id: 'b', rev: 1 },
      ],
      entry: { id: 'a', rev: 2 },
      getKey,
      maxEntries: 2,
    })
    expect(
      undoBoundedListSave({
        entries: oversizedUpdate.next,
        mutation: oversizedUpdate,
        getKey,
        isSameEntry: isSame,
        maxEntries: 1,
      })
    ).toEqual({ ok: false, conflict: true, next: oversizedUpdate.next })

    // undoBoundedListSave when evictedEntry is already back in fresh entries
    const evicting = applyBoundedListSave({
      entries: [
        { id: 'a', rev: 1 },
        { id: 'b', rev: 1 },
      ],
      entry: { id: 'c', rev: 1 },
      getKey,
      maxEntries: 2,
    })
    expect(evicting.evictedEntry).toEqual({ id: 'b', rev: 1 })
    expect(
      undoBoundedListSave({
        entries: [
          { id: 'c', rev: 1 },
          { id: 'b', rev: 1 },
        ],
        mutation: evicting,
        getKey,
        isSameEntry: isSame,
        maxEntries: 2,
      })
    ).toEqual({ ok: true, next: [{ id: 'b', rev: 1 }] })

    // undoBoundedListRemove when removedKey was already re-added (line 333)
    const removed = applyBoundedListRemove({
      entries: [
        { id: 'a', rev: 1 },
        { id: 'b', rev: 1 },
      ],
      key: 'a',
      getKey,
    })!
    const readded = [
      { id: 'a', rev: 2 },
      { id: 'b', rev: 1 },
    ]
    expect(
      undoBoundedListRemove({
        entries: readded,
        mutation: removed,
        getKey,
      })
    ).toEqual({ ok: false, conflict: true, next: readded })

    // isOfflineError cyclic cause, non-offline cause, and unknown error code
    const cyclic: { cause?: unknown } = {}
    cyclic.cause = cyclic
    expect(isOfflineError(cyclic)).toBe(false)
    expect(isOfflineError({ code: 'EUNKNOWN', cause: new Error('500 error') })).toBe(
      false
    )
  })
})
