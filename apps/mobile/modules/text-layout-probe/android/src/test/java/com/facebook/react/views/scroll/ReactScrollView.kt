package com.facebook.react.views.scroll

import android.content.Context
import android.widget.ScrollView

/** Stand-in with React Native's name: scrollEnabled as the real ReactScrollView carries it. */
class ReactScrollView(context: Context) : ScrollView(context) {
  var scrollEnabled: Boolean = true
}
