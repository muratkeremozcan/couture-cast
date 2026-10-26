/** Verify the focused RN Dialog window, independently of the backing Activity. */
export function assertShareCardDialogStatusBar(dump, appId) {
  const focused = dump.match(/mCurrentFocus=Window\{([a-f0-9]+) u\d+ ([^}]+)\}/)
  if (!focused || focused[2] !== `${appId}/${appId}.MainActivity`)
    throw new Error('share_card_dialog_not_focused')
  const section = dump
    .split(/\n {2}Window #/)
    .find((block) => block.match(/^\d+ Window\{([a-f0-9]+) /)?.[1] === focused[1])
  if (
    !section ||
    !/\bty=APPLICATION\b/.test(section) ||
    !/\bapr=[^\n]*\bLIGHT_STATUS_BARS\b/.test(section)
  )
    throw new Error('share_card_dialog_dark_status_icons_required')
  return true
}
