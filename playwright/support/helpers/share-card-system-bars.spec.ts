import { expect, it } from 'vitest'
import { assertShareCardDialogStatusBar } from '../../../scripts/lib/share-card-system-bars.mjs'
const id = 'com.couturecast.story68'
const dump = (dialog: string, activity = 'LIGHT_STATUS_BARS') =>
  `WINDOW MANAGER\n  mCurrentFocus=Window{abc u0 ${id}/${id}.MainActivity}\n  Window #8 Window{abc u0 ${id}/${id}.MainActivity}:\n    ty=APPLICATION\n    apr=${dialog}\n  Window #9 Window{def u0 ${id}/${id}.MainActivity}:\n    ty=BASE_APPLICATION\n    apr=${activity}\n`
it('checks the focused Dialog appearance separately from the Activity copied at show', () => {
  expect(assertShareCardDialogStatusBar(dump('LIGHT_STATUS_BARS', ''), id)).toBe(true)
  expect(() => assertShareCardDialogStatusBar(dump('', 'LIGHT_STATUS_BARS'), id)).toThrow(
    'dark_status_icons_required'
  )
  expect(() =>
    assertShareCardDialogStatusBar(
      dump('LIGHT_STATUS_BARS').replace('ty=APPLICATION', 'ty=BASE_APPLICATION'),
      id
    )
  ).toThrow('dark_status_icons_required')
})
it('refuses missing or foreign focus and a missing focused window section', () => {
  expect(() => assertShareCardDialogStatusBar('', id)).toThrow('not_focused')
  expect(() =>
    assertShareCardDialogStatusBar(dump('LIGHT_STATUS_BARS'), 'foreign.app')
  ).toThrow('not_focused')
  expect(() =>
    assertShareCardDialogStatusBar(dump('LIGHT_STATUS_BARS').split('  Window #8')[0]!, id)
  ).toThrow('dark_status_icons_required')
})
