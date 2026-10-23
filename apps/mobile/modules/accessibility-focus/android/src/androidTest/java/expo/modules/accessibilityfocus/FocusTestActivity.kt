package expo.modules.accessibilityfocus

import android.app.Activity
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView

/** Real views TalkBack can focus, with ids standing in for React tags. */
class FocusTestActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val column =
      LinearLayout(this).apply {
        id = ROOT
        orientation = LinearLayout.VERTICAL
      }
    for ((tag, label) in listOf(FIRST to "First look", SECOND to "Second look")) {
      column.addView(
        TextView(this).apply {
          id = tag
          text = label
          isFocusable = true
          minHeight = 160
        }
      )
    }
    setContentView(column)
  }

  companion object {
    const val ROOT = 100
    const val FIRST = 101
    const val SECOND = 102
  }
}
