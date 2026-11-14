package com.facebook.react.views.switchview

import android.content.Context
import android.widget.Switch

/**
 * Stands in for React Native's ReactSwitch by name. The real one is a SwitchCompat; both carry
 * getShowText, which the probe reads by name, and draw thumb text with a layout of their own.
 */
class ReactSwitch(context: Context) : Switch(context)
