const ownedAppId = 'com.couturecast.story68'
const developmentUrl =
  'couturecast-story68://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8089'

/** Cold configuration avoids overlapping development roots during Android recreation. */
export async function withColdAndroidFontScale(
  { appId, adb, device, run, openUrl, maestro },
  work
) {
  if (
    appId !== ownedAppId ||
    typeof adb !== 'string' ||
    !adb ||
    typeof device !== 'string' ||
    !device
  )
    throw new Error('owned_android_font_scale_target_required')
  const previous = (
    await run(adb, ['-s', device, 'shell', 'settings', 'get', 'system', 'font_scale'])
  ).trim()
  const stop = () => run(adb, ['-s', device, 'shell', 'am', 'force-stop', ownedAppId])
  const reopen = async () => {
    await openUrl(developmentUrl)
    await maestro('maestro/story65/open-app.yaml')
  }
  let restoreRequired = false
  let failure
  let failed = false
  let value
  try {
    await stop()
    // A failed acknowledgement can follow an applied setting, so arm cleanup first.
    restoreRequired = true
    await run(adb, [
      '-s',
      device,
      'shell',
      'settings',
      'put',
      'system',
      'font_scale',
      '1.5',
    ])
    await reopen()
    value = await work()
  } catch (error) {
    failure = error
    failed = true
  } finally {
    if (restoreRequired) {
      try {
        await stop()
        const restore =
          previous === 'null'
            ? ['delete', 'system', 'font_scale']
            : ['put', 'system', 'font_scale', previous]
        await run(adb, ['-s', device, 'shell', 'settings', ...restore])
        await reopen()
      } catch (cleanupError) {
        failure = failed
          ? new AggregateError(
              [failure, cleanupError],
              'android_font_scale_restore_failed'
            )
          : cleanupError
        failed = true
      }
    }
  }
  if (failed) throw failure
  return value
}
