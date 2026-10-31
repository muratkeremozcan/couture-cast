import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8')
const open = read('maestro/story65/open-notification-settings.yaml')

/** Every Maestro flow under maestro/, repo-relative. */
function flows(dir = 'maestro') {
  return fs
    .readdirSync(new URL(`${dir}/`, root), { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.posix.join(dir, entry.name)
      if (entry.isDirectory()) return flows(file)
      return file.endsWith('.yaml') ? [file] : []
    })
}

test('the notification settings flow waits on the screen, which is on screen at every size', () => {
  // Sign out is the last control: on an iPhone SE it sits below the fold once preferences load.
  assert.match(open, /visible:\s+id: 'notification-settings-screen'/)
  assert.doesNotMatch(open, /\$\{MAESTRO_SIGNOUT\}/)
  assert.doesNotMatch(
    open,
    /scrollUntilVisible:\s+element: \$\{MAESTRO_(SIGNOUT|SIGNIN)\}/
  )
  assert.match(
    read('apps/mobile/app/notification-settings.tsx'),
    /<ScrollView[^>]*testID="notification-settings-screen"/
  )
})

test('a flow scrolls to Sign in or Sign out before it taps it', () => {
  const taps = []
  for (const file of flows()) {
    const flow = read(file)
    for (const key of ['MAESTRO_SIGNIN', 'MAESTRO_SIGNOUT']) {
      const tap = flow.indexOf(`- tapOn: \${${key}}`)
      if (tap === -1) continue
      taps.push(`${file}:${key}`)
      const scroll = flow.indexOf(`element: \${${key}}`)
      const opensSignin =
        key === 'MAESTRO_SIGNIN' &&
        /runFlow: (\.\.\/story65\/)?open-signin\.yaml/.test(flow)
      assert.ok(
        (scroll !== -1 && scroll < tap) || opensSignin,
        `${file} taps ${key} unscrolled`
      )
    }
  }
  assert.deepEqual(taps.sort(), [
    'maestro/story65/session-signout.yaml:MAESTRO_SIGNOUT',
    'maestro/story65/signin-request.yaml:MAESTRO_SIGNIN',
    'maestro/story67/signin-email.yaml:MAESTRO_SIGNIN',
    'maestro/story67/teaser-signout.yaml:MAESTRO_SIGNOUT',
    'maestro/story68/signout.yaml:MAESTRO_SIGNOUT',
  ])
  assert.match(read('maestro/story65/open-signin.yaml'), /element: \$\{MAESTRO_SIGNIN\}/)
})

test('callers that read the top of the screen still get it', () => {
  // The flow leaves the screen at its top: these callers check the Switch, the iOS back label or
  // the Try again control next, with no scroll in between.
  for (const file of [
    'maestro/story65/notification-permission.yaml',
    'maestro/story65/notification-settings-loaded.yaml',
    'maestro/story65/session-restore.yaml',
    'maestro/story68/prefs-failed.yaml',
  ]) {
    const flow = read(file)
    const after = flow.slice(flow.indexOf('open-notification-settings.yaml'))
    assert.doesNotMatch(
      after.split('\n').slice(0, 4).join('\n'),
      /scrollUntilVisible/,
      file
    )
  }
})
