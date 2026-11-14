package com.facebook.react

/**
 * Stands in for React Native's R class by name: BaseViewManager.setTestId stores testID as the
 * view tag keyed `R.id.react_test_id`, which the probe reads from this class. Any key with an
 * application package byte is accepted by View.setTag.
 */
@Suppress("ClassName")
object R {
  object id {
    @JvmField val react_test_id: Int = 0x7f0f0a01
  }
}
