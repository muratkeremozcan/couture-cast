package expo.modules.modalsystembars

import android.app.Activity
import android.app.Dialog
import android.os.Looper
import org.robolectric.Shadows.shadowOf
import android.view.View
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ModalSystemBarsTest {
  @Test fun onlyAttachedDialogWindowIsStyledAcrossCloseAndReopen() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().visible().get()
    val activityRoot = activity.window.decorView
    @Suppress("DEPRECATION")
    val original = activityRoot.systemUiVisibility
    repeat(2) {
      val dialog = Dialog(activity)
      val child = View(activity)
      dialog.setContentView(child)
      dialog.show()
      shadowOf(Looper.getMainLooper()).idle()
      assertTrue(setDarkModalStatusBar(child))
      @Suppress("DEPRECATION")
      assertTrue(child.rootView.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR != 0)
      @Suppress("DEPRECATION")
      assertEquals(original, activityRoot.systemUiVisibility)
      dialog.dismiss()
      shadowOf(Looper.getMainLooper()).idle()
      assertFalse(setDarkModalStatusBar(child))
    }
    assertFalse(setDarkModalStatusBar(null))
    assertFalse(setDarkModalStatusBar(View(activity)))
  }
}
