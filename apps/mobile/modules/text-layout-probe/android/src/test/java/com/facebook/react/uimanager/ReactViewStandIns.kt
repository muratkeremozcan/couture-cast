package com.facebook.react.uimanager

import android.content.Context
import android.graphics.Canvas
import android.widget.FrameLayout

/** React Native's overflow contract (ReactOverflowView.kt). */
interface ReactOverflowView {
  val overflow: String?
}

/** React Native's text-like view contract (ReactCompoundView.kt). */
interface ReactCompoundView {
  fun reactTagForTouch(touchX: Float, touchY: Float): Int
}

/**
 * Behaves as React Native's ReactViewGroup does for clipping: `clipChildren` off, and children cut
 * to its own bounds in dispatchDraw when overflow is not visible.
 */
class OverflowViewGroup(context: Context, override val overflow: String?) :
  FrameLayout(context), ReactOverflowView {
  init {
    clipChildren = false
  }

  override fun dispatchDraw(canvas: Canvas) {
    if (overflow != "visible") canvas.clipRect(0, 0, width, height)
    super.dispatchDraw(canvas)
  }
}
