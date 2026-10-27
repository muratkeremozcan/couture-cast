package expo.modules.modalsystembars

import android.app.Activity
import android.app.Dialog
import android.os.Build
import android.os.Looper
import org.robolectric.Shadows.shadowOf
import android.view.View
import android.view.WindowInsetsController
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class ModalSystemBarsTest {
  /** Opens, styles and dismisses two dialogs; [styled] reads the SDK branch's own window state. */
  private fun assertOnlyAttachedDialogWindowIsStyled(styled: (View) -> Boolean) {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().visible().get()
    val activityRoot = activity.window.decorView
    assertFalse("Activity starts with dark status icons", styled(activityRoot))
    repeat(2) {
      val dialog = Dialog(activity)
      val child = View(activity)
      dialog.setContentView(child)
      dialog.show()
      shadowOf(Looper.getMainLooper()).idle()
      assertFalse("Dialog starts with dark status icons", styled(child.rootView))
      assertTrue(setDarkModalStatusBar(child))
      assertTrue("Dialog window has light-status appearance", styled(child.rootView))
      assertFalse("Activity window keeps its own appearance", styled(activityRoot))
      dialog.dismiss()
      shadowOf(Looper.getMainLooper()).idle()
      assertFalse(setDarkModalStatusBar(child))
    }
    assertFalse(setDarkModalStatusBar(null))
    assertFalse(setDarkModalStatusBar(View(activity)))
  }

  @Test
  @Config(sdk = [28])
  fun legacySystemUiVisibilityStylesOnlyTheAttachedDialogWindow() {
    assertEquals(28, Build.VERSION.SDK_INT)
    @Suppress("DEPRECATION")
    assertOnlyAttachedDialogWindowIsStyled { it.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR != 0 }
  }

  /** API 30+ devices (the API32/API36 CI emulators) take the WindowInsetsController branch. */
  @Test
  @Config(sdk = [33])
  fun windowInsetsControllerStylesOnlyTheAttachedDialogWindow() {
    assertEquals(33, Build.VERSION.SDK_INT)
    assertOnlyAttachedDialogWindowIsStyled {
      it.windowInsetsController!!.systemBarsAppearance and WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS != 0
    }
  }
}
