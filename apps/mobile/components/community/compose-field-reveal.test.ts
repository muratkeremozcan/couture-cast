// Story 6.7b R16: the measurements that keep the focused compose field in view
// when the keyboard shrinks the sheet's scroll viewport.
import { describe, expect, it } from 'vitest'
import { isRectInViewport, revealOffset } from './compose-field-reveal'

describe('compose field reveal (Story 6.7b R16)', () => {
  it('6.7b-MOB-070 a field below a viewport the keyboard shrank is out of view', () => {
    const caption = { top: 520, bottom: 640 }
    // Before the keyboard: the whole sheet content fits.
    expect(isRectInViewport(caption, { offset: 0, height: 700 })).toBe(true)
    // The keyboard view takes about 340 pt; the offset stays where it was.
    expect(isRectInViewport(caption, { offset: 0, height: 360 })).toBe(false)
    expect(isRectInViewport(caption, { offset: 0, height: 0 })).toBe(false)
  })

  it('6.7b-MOB-071 scrolls just enough to bring the field and its counter into view', () => {
    const caption = { top: 520, bottom: 640 }
    const offset = revealOffset(caption, { offset: 0, height: 360 }, 8)
    expect(offset).toBe(640 + 8 - 360)
    expect(isRectInViewport(caption, { offset: offset!, height: 360 })).toBe(true)
  })

  it('6.7b-MOB-072 leaves a field in view alone, and aligns a field above the frame by its top', () => {
    expect(revealOffset({ top: 100, bottom: 200 }, { offset: 0, height: 360 })).toBeNull()
    expect(revealOffset({ top: 100, bottom: 200 }, { offset: 300, height: 360 })).toBe(92)
    expect(revealOffset({ top: 4, bottom: 40 }, { offset: 300, height: 360 })).toBe(0)
  })

  it('6.7b-MOB-073 a field taller than the frame shows its label row first', () => {
    const tall = { top: 400, bottom: 900 }
    expect(revealOffset(tall, { offset: 0, height: 360 }, 8)).toBe(392)
  })

  it('6.7b-MOB-074 nothing is in view, and nothing scrolls, before the frame is measured', () => {
    expect(revealOffset({ top: 0, bottom: 10 }, { offset: 0, height: 0 })).toBeNull()
  })
})
