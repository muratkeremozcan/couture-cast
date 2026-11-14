package com.facebook.react.views.text

import android.content.Context
import android.text.Layout
import android.view.ViewGroup
import android.widget.TextView
import com.facebook.react.uimanager.ReactCompoundView

/**
 * Stand-ins with React Native's class names, so the probe's by-name lookups run against them. The
 * real ReactTextView is an AppCompatTextView that draws its own Layout; PreparedLayoutTextView is
 * a ViewGroup holding a PreparedLayout.
 */
open class ReactTextView(context: Context) : TextView(context), ReactCompoundView {
  override fun reactTagForTouch(touchX: Float, touchY: Float): Int = id
}

class PreparedLayout(
  val layout: Layout,
  val maximumNumberOfLines: Int,
  val verticalOffset: Float
)

class PreparedLayoutTextView(context: Context) : ViewGroup(context), ReactCompoundView {
  var preparedLayout: PreparedLayout? = null

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun reactTagForTouch(touchX: Float, touchY: Float): Int = id
}
