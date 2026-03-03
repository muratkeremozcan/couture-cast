import { Link, type ExternalPathString } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import type { ComponentProps } from 'react'
import { Platform } from 'react-native'
import { usePostHog } from 'posthog-react-native'

export function ExternalLink(
  props: Omit<ComponentProps<typeof Link>, 'href'> & { href: ExternalPathString }
) {
  const posthog = usePostHog()

  return (
    <Link
      target="_blank"
      {...props}
      href={props.href}
      onPress={(e) => {
        // Track external link taps for user engagement analytics
        // @see https://posthog.com/docs/libraries/react-native#capturing-events
        posthog.capture('external_link_tapped', { url: props.href })

        if (Platform.OS !== 'web') {
          // Prevent the default behavior of linking to the default browser on native.
          e.preventDefault()
          // Open the link in an in-app browser.
          void WebBrowser.openBrowserAsync(props.href)
        }
      }}
    />
  )
}
